"""Builds the files of the test targets ahead of time: python -m spherex_explorer.precompute.

A bundle is the answer of `exposures` and of `frames` for one target and one detector,
saved in the format of docs/api-contract.md. The site shows the five test targets of the
challenge from these files, at once, even when the service or the archive is asleep.
The same code as the live service builds them, so both give the same frames.
"""

import argparse
import asyncio
import json
import logging
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx2

from spherex_explorer import __version__
from spherex_explorer.api.exposures import exposure_out, grid_out
from spherex_explorer.api.frames import frame_out
from spherex_explorer.api.resolve import NameResolver
from spherex_explorer.archive import Level2Reader, S3Reader, SiaArchive
from spherex_explorer.config import Settings, get_settings
from spherex_explorer.errors import NotFound, UpstreamUnavailable
from spherex_explorer.frames import DEFAULT_FOV_DEG, DEFAULT_SIZE
from spherex_explorer.pipeline import (
    ExposureArchive,
    FrameSource,
    ListedExposure,
    build_frame,
    list_exposures,
)
from spherex_explorer.targets import SesameResolver, Target

logger = logging.getLogger(__name__)

BUNDLE_FORMAT = "spherex-explorer/bundle"
INDEX_FORMAT = "spherex-explorer/index"
FORMAT_VERSION = 1
INDEX_FILE = "index.json"
_ANGLE_DECIMALS = 6
_MOTION_DECIMALS = 3
# Attempts for one frame when the storage is busy, and the pause before the next one.
_FRAME_ATTEMPTS = 4
_FRAME_PAUSE_S = 3.0


@dataclass(frozen=True, slots=True)
class BundleTarget:
    """A target to build files for: its key in file names, its name on screen, its catalog name."""

    key: str
    name: str
    catalog_name: str


# The five test targets of the challenge. Catalogs know designations, not nicknames.
TARGETS = (
    BundleTarget("barnard-star", "Barnard's Star", "Barnard's Star"),
    BundleTarget("epsilon-indi-b", "Epsilon Indi B", "eps Ind B"),
    BundleTarget("wise-0855", "WISE 0855", "WISE J085510.83-071442.5"),
    BundleTarget("rw-aurigae", "RW Aurigae", "RW Aur"),
    BundleTarget("r-draconis", "R Draconis", "R Dra"),
)


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write(path: Path, content: dict) -> int:
    """Write a compact JSON file and give its size in bytes."""
    text = json.dumps(content, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n"
    data = text.encode("utf-8")
    path.write_bytes(data)
    return len(data)


async def _frame_or_none(
    frames: FrameSource,
    listed: ListedExposure,
    target: Target,
    grid,
    slots: asyncio.Semaphore,
    sleep,
) -> dict | None:
    """Frame of one exposure as the contract writes it. None when the archive lost its file."""
    exposure_id = listed.exposure.id
    for attempt in range(1, _FRAME_ATTEMPTS + 1):
        try:
            async with slots:
                frame = await build_frame(frames, exposure_id, target, grid)
            return frame_out(frame).model_dump()
        except NotFound:
            logger.warning("%s: no file in the archive, frame left out", exposure_id)
            return None
        except UpstreamUnavailable as exc:
            if attempt == _FRAME_ATTEMPTS:
                raise
            logger.warning("%s: %s, attempt %d", exposure_id, exc, attempt)
            await sleep(_FRAME_PAUSE_S)
    return None


async def build_target(
    wanted: BundleTarget,
    *,
    resolver: NameResolver,
    archive: ExposureArchive,
    frames: FrameSource,
    output: Path,
    fov_deg: float = DEFAULT_FOV_DEG,
    size: int = DEFAULT_SIZE,
    parallel: int = 16,
    sleep=asyncio.sleep,
) -> dict:
    """Build the files of one target, one per detector, and give its entry of the index."""
    found = await resolver.resolve(wanted.catalog_name)
    # The numbers written in the file are the ones the frames are computed with, so that
    # a browser that redoes the arithmetic finds the same positions.
    target = Target(
        ra=round(found.ra, _ANGLE_DECIMALS),
        dec=round(found.dec, _ANGLE_DECIMALS),
        epoch=found.epoch,
        pm_ra=round(found.pm_ra or 0.0, _MOTION_DECIMALS),
        pm_dec=round(found.pm_dec or 0.0, _MOTION_DECIMALS),
    )
    target_out = {
        "name": wanted.name,
        "ra": target.ra,
        "dec": target.dec,
        "epoch": target.epoch,
        "pm_ra": target.pm_ra,
        "pm_dec": target.pm_dec,
    }
    listing = await list_exposures(archive, target, fov_deg=fov_deg, size=size)
    grid = grid_out(listing.grid).model_dump()
    logger.info("%s: %d exposures", wanted.name, len(listing.exposures))

    slots = asyncio.Semaphore(parallel)
    detectors = []
    for detector in sorted({listed.exposure.detector for listed in listing.exposures}):
        chosen = [listed for listed in listing.exposures if listed.exposure.detector == detector]
        built = await asyncio.gather(
            *(
                _frame_or_none(frames, listed, target, listing.grid, slots, sleep)
                for listed in chosen
            )
        )
        kept = [(listed, frame) for listed, frame in zip(chosen, built, strict=True) if frame]
        if not kept:
            continue
        name = f"{wanted.key}-d{detector}.json"
        wavelengths = [frame["wavelength_um"] for _, frame in kept]
        size_bytes = _write(
            output / name,
            {
                "format": BUNDLE_FORMAT,
                "version": FORMAT_VERSION,
                "generated": _now(),
                "target": target_out,
                "grid": grid,
                "exposures": [exposure_out(listed).model_dump(by_alias=True) for listed, _ in kept],
                "frames": [frame for _, frame in kept],
            },
        )
        detectors.append(
            {
                "detector": detector,
                "file": name,
                "frames": len(kept),
                "wavelength_um": [min(wavelengths), max(wavelengths)],
                "bytes": size_bytes,
            }
        )
        logger.info("%s: %s, %d frames, %.1f MB", wanted.name, name, len(kept), size_bytes / 1e6)

    passes = {listed.pass_number for listed in listing.exposures}
    return {
        "key": wanted.key,
        "name": wanted.name,
        "target": target_out,
        "grid": grid,
        "passes": len(passes),
        "detectors": detectors,
    }


def write_index(output: Path, entries: Sequence[dict]) -> None:
    """Write the list of the files. Targets built earlier and not rebuilt now are kept."""
    path = output / INDEX_FILE
    known: dict[str, dict] = {}
    if path.exists():
        try:
            previous = json.loads(path.read_text(encoding="utf-8"))
            known = {entry["key"]: entry for entry in previous.get("targets", [])}
        except (ValueError, KeyError, TypeError, AttributeError):
            logger.warning("%s cannot be read: it is written again from scratch", path)
    known.update({entry["key"]: entry for entry in entries})
    order = {wanted.key: rank for rank, wanted in enumerate(TARGETS)}
    targets = sorted(known.values(), key=lambda entry: order.get(entry["key"], len(order)))
    _write(
        path,
        {
            "format": INDEX_FORMAT,
            "version": FORMAT_VERSION,
            "generated": _now(),
            "targets": targets,
        },
    )


async def run(settings: Settings, output: Path, keys: Sequence[str], parallel: int) -> None:
    wanted = [target for target in TARGETS if not keys or target.key in keys]
    limits = httpx2.Limits(
        max_connections=settings.storage_concurrency + 8,
        max_keepalive_connections=settings.storage_concurrency,
    )
    async with httpx2.AsyncClient(
        timeout=settings.archive_timeout_s,
        limits=limits,
        headers={"User-Agent": f"spherex-explorer/{__version__}"},
    ) as client:
        resolver = SesameResolver(
            client, urls=settings.resolver_url_list, timeout_s=settings.resolver_timeout_s
        )
        archive = SiaArchive(
            client,
            url=settings.sia_url,
            collections=settings.sia_collection_list,
            bucket=settings.archive_bucket,
            radius_deg=settings.search_radius_deg,
            timeout_s=settings.archive_timeout_s,
            budget_s=settings.archive_budget_s,
            attempts=settings.archive_attempts,
            max_exposures=settings.max_exposures,
        )
        frames = Level2Reader(
            S3Reader(
                client,
                base_url=settings.storage_url,
                timeout_s=settings.storage_timeout_s,
                attempts=settings.storage_attempts,
                concurrency=settings.storage_concurrency,
            )
        )
        for target in wanted:
            entry = await build_target(
                target,
                resolver=resolver,
                archive=archive,
                frames=frames,
                output=output,
                parallel=parallel,
            )
            # The index is written after each target: a run cut short keeps what it built.
            write_index(output, [entry])


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the files of the test targets.")
    parser.add_argument("--output", type=Path, required=True, help="Folder the files go to.")
    parser.add_argument(
        "--target",
        action="append",
        default=[],
        choices=[target.key for target in TARGETS],
        help="Target to build. Repeat it for several. All of them when left out.",
    )
    parser.add_argument("--parallel", type=int, default=16, help="Frames built at once.")
    arguments = parser.parse_args(argv)
    if not arguments.output.is_dir():
        parser.error(f"{arguments.output} is not a folder")
    if arguments.parallel < 1:
        parser.error("--parallel must be at least 1")

    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx2").setLevel("WARNING")
    try:
        asyncio.run(run(get_settings(), arguments.output, arguments.target, arguments.parallel))
    except (NotFound, UpstreamUnavailable) as exc:
        logger.error("Stopped: %s", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
