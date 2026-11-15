"""Builds the files of the test targets ahead of time: python -m spherex_explorer.precompute.

A bundle is the answer of `exposures` and of `frames` for one target and one detector,
a spectrum file is the answer of `spectrum`, a candidates file that of `candidates` and
a catalog file that of `catalog`, all saved in the formats of docs/api-contract.md. The
site shows the five test targets of the challenge from these files, at once, even when
the service or the archive is asleep. The same code as the live service builds them, so
both give the same frames, the same fluxes and the same candidates.

A sixth target is not one of the challenge, and is not real: a quiet field of the sky
with a made-up body of the outer solar system drawn on its frames. It shows what the
search for such a body finds when there is one. Each of its files says it is made up.
"""

import argparse
import asyncio
import base64
import json
import logging
import sys
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path

import httpx2
import numpy as np

from spherex_explorer import __version__
from spherex_explorer.api.candidates import candidates_out
from spherex_explorer.api.catalog import catalogs_out
from spherex_explorer.api.exposures import exposure_out, grid_out
from spherex_explorer.api.frames import frame_out
from spherex_explorer.api.resolve import NameResolver
from spherex_explorer.api.spectrum import point_out
from spherex_explorer.archive import Level2Reader, S3Reader, SiaArchive
from spherex_explorer.catalogs import VizierCatalogs
from spherex_explorer.config import Settings, get_settings
from spherex_explorer.detection import MOVED, SWUNG, FieldFrame
from spherex_explorer.errors import NotFound, UpstreamError, UpstreamUnavailable
from spherex_explorer.frames import DEFAULT_FOV_DEG, DEFAULT_SIZE, Grid
from spherex_explorer.journal import JOURNAL_FIELDS, JournalField, entries_of
from spherex_explorer.pipeline import (
    ExposureArchive,
    FrameSource,
    ListedExposure,
    SkyCatalogs,
    build_frame,
    find_field_candidates,
    list_exposures,
    measure_spectrum,
    report_field,
    view_catalogs,
)
from spherex_explorer.synthetic import SyntheticBody, add_body
from spherex_explorer.targets import SesameResolver, Target

logger = logging.getLogger(__name__)

BUNDLE_FORMAT = "spherex-explorer/bundle"
INDEX_FORMAT = "spherex-explorer/index"
SPECTRUM_FORMAT = "spherex-explorer/spectrum"
CANDIDATES_FORMAT = "spherex-explorer/candidates"
CATALOG_FORMAT = "spherex-explorer/catalog"
JOURNAL_FORMAT = "spherex-explorer/journal"
JOURNAL_FILE = "journal.json"
FORMAT_VERSION = 1
INDEX_FILE = "index.json"
_ANGLE_DECIMALS = 6
_MOTION_DECIMALS = 3
# Attempts for one frame when the storage is busy, and the pause before the next one.
_MJD_J2000 = 51544.5
_DAYS_PER_JULIAN_YEAR = 365.25
_EPOCH_DECIMALS = 3
_FRAME_ATTEMPTS = 4
_FRAME_PAUSE_S = 3.0


@dataclass(frozen=True, slots=True)
class BundleTarget:
    """A target to build files for: its key in file names, its name on screen, its catalog name.

    With a `body`, the target is a made-up one: no catalog knows it. Its place is where
    the Sun would see the body, and the body is drawn on every frame of its field.
    """

    key: str
    name: str
    catalog_name: str
    body: SyntheticBody | None = None


# The five test targets of the challenge. Catalogs know designations, not nicknames.
TARGETS = (
    BundleTarget("barnard-star", "Barnard's Star", "Barnard's Star"),
    BundleTarget("epsilon-indi-b", "Epsilon Indi B", "eps Ind B"),
    BundleTarget("wise-0855", "WISE 0855", "WISE J085510.83-071442.5"),
    BundleTarget("rw-aurigae", "RW Aurigae", "RW Aur"),
    BundleTarget("r-draconis", "R Draconis", "R Dra"),
)


# A made-up body in a real field, to show the search for a swing at work. The field is a
# quiet one, far from the Milky Way, and the body sits where no star is at either end
# of its swing. It is cold, seen from 3.8 to 5 micrometers only as WISE 0855 is, three
# times as bright, and it moves as a body on a round orbit at that distance would.
SYNTHETIC_NOTE = (
    "A made-up body added to real SPHEREx frames to test the search for a swing. It does not exist."
)
SYNTHETIC_TARGETS = (
    BundleTarget(
        "synthetic-planet-x",
        "Synthetic Planet X",
        "",
        SyntheticBody(
            Target(ra=199.990528, dec=29.994922, epoch=2025.94, pm_ra=-2000.0, pm_dec=1900.0),
            distance_au=6000.0,
            flux_mjy={5: 0.45, 6: 1.5},
        ),
    ),
)
EVERY_TARGET = TARGETS + SYNTHETIC_TARGETS


def synthetic_out(body: SyntheticBody) -> dict:
    """What a file built with a made-up body says of it."""
    return {
        "note": SYNTHETIC_NOTE,
        "distance_au": body.distance_au,
        "parallax_arcsec": round(body.parallax_arcsec, 2),
        "flux_mjy": {str(detector): flux for detector, flux in sorted(body.flux_mjy.items())},
    }


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
    body: SyntheticBody | None = None,
) -> dict | None:
    """Frame of one exposure as the contract writes it. None when the archive lost its file.

    A made-up body is drawn on the image where it would be at the date of the frame.
    """
    exposure_id = listed.exposure.id
    for attempt in range(1, _FRAME_ATTEMPTS + 1):
        try:
            async with slots:
                frame = await build_frame(frames, exposure_id, target, grid)
            if body is not None:
                drawn = add_body(frame.image, grid, listed.exposure.detector, frame.time_mjd, body)
                frame = replace(frame, image=drawn)
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
    with_frames: bool = True,
    sleep=asyncio.sleep,
) -> dict:
    """Build the files of one target and give its entry of the index.

    The files are one bundle per detector and one spectrum. Without the frames, only
    the spectrum is built, and the entry only holds what describes it.
    """
    body = wanted.body
    found = body.seen_from_the_sun if body else await resolver.resolve(wanted.catalog_name)
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
    spectrum = await _write_spectrum(wanted, target, target_out, archive, frames, output, sleep)
    if not with_frames:
        return {"key": wanted.key, "spectrum": spectrum}
    listing = await list_exposures(archive, target, fov_deg=fov_deg, size=size)
    grid = grid_out(listing.grid).model_dump()
    logger.info("%s: %d exposures", wanted.name, len(listing.exposures))

    slots = asyncio.Semaphore(parallel)
    detectors = []
    for detector in sorted({listed.exposure.detector for listed in listing.exposures}):
        chosen = [listed for listed in listing.exposures if listed.exposure.detector == detector]
        built = await asyncio.gather(
            *(
                _frame_or_none(frames, listed, target, listing.grid, slots, sleep, body)
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
                **({"synthetic": synthetic_out(body)} if body else {}),
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
    entry = {
        "key": wanted.key,
        "name": wanted.name,
        "target": target_out,
        "grid": grid,
        "passes": len(passes),
        "detectors": detectors,
        "spectrum": spectrum,
        **({"synthetic": synthetic_out(body)} if body else {}),
    }
    candidates = write_candidates(wanted.key, output, [d["file"] for d in detectors])
    if candidates is not None:
        entry["candidates"] = candidates
    return entry


def _bundle_frames(bundle: dict) -> list[FieldFrame]:
    """The frames of a bundle as the detection needs them."""
    size = bundle["grid"]["size"]
    listed = {exposure["id"]: exposure for exposure in bundle["exposures"]}
    frames = []
    for frame in bundle["frames"]:
        exposure = listed[frame["id"]]
        image = np.frombuffer(base64.b64decode(frame["image"]), dtype="<f2")
        mask = np.frombuffer(base64.b64decode(frame["mask"]), dtype=np.uint8)
        frames.append(
            FieldFrame(
                detector=exposure["detector"],
                pass_number=exposure["pass"],
                time_mjd=frame["time_mjd"],
                wavelength_um=frame["wavelength_um"],
                bandwidth_um=frame["bandwidth_um"],
                background=frame["background"],
                image=image.astype(np.float32).reshape(size, size),
                mask=mask.reshape(size, size),
            )
        )
    return frames


def write_candidates(key: str, output: Path, bundles: Sequence[str]) -> dict | None:
    """Write the candidates file of one target and give what the index says about it.

    The field is measured on the frames of the bundles, the very ones the site shows.
    None when the target has no bundle.
    """
    target_out: dict = {}
    grid: dict = {}
    synthetic: dict | None = None
    frames: list[FieldFrame] = []
    for name in bundles:
        bundle = json.loads((output / name).read_text(encoding="utf-8"))
        target_out, grid = bundle["target"], bundle["grid"]
        synthetic = bundle.get("synthetic", synthetic)
        frames += _bundle_frames(bundle)
    if not frames:
        return None
    target = Target(
        ra=target_out["ra"],
        dec=target_out["dec"],
        epoch=target_out["epoch"],
        pm_ra=target_out["pm_ra"],
        pm_dec=target_out["pm_dec"],
    )
    report = candidates_out(report_field(target, Grid(**grid), frames)).model_dump(by_alias=True)
    name = f"{key}-candidates.json"
    size_bytes = _write(
        output / name,
        {
            "format": CANDIDATES_FORMAT,
            "version": FORMAT_VERSION,
            "generated": _now(),
            **report,
            # As in the other files of a target, its name comes with its position.
            "target": target_out,
            # Frames with a made-up body give a made-up candidate: the file says so.
            **({"synthetic": synthetic} if synthetic else {}),
        },
    )
    found = report["candidates"]
    moved = sum(1 for candidate in found if candidate["kind"] == MOVED)
    swung = sum(1 for candidate in found if candidate["kind"] == SWUNG)
    logger.info("%s: %s, %d candidates", key, name, len(found))
    return {
        "file": name,
        "count": len(found),
        "moved": moved,
        "swung": swung,
        "changed": len(found) - moved - swung,
        "bytes": size_bytes,
    }


def rebuild_candidates(output: Path, keys: Sequence[str]) -> None:
    """Write again the candidates files of targets whose bundles are already there.

    Nothing is downloaded: it is the way to follow a change of the detection.
    """
    index = json.loads((output / INDEX_FILE).read_text(encoding="utf-8"))
    for entry in index["targets"]:
        if keys and entry["key"] not in keys:
            continue
        bundles = [detector["file"] for detector in entry.get("detectors", [])]
        candidates = write_candidates(entry["key"], output, bundles)
        if candidates is not None:
            write_index(output, [{"key": entry["key"], "candidates": candidates}])


def _middle_of_the_visits(output: Path, entry: dict) -> float | None:
    """Middle of the dates of the frames of a target, as a Julian year. None without frames."""
    listed = entry.get("candidates")
    if not listed:
        return None
    visits = json.loads((output / listed["file"]).read_text(encoding="utf-8"))["visits"]
    if not visits:
        return None
    middle = (visits[0]["time_mjd"] + visits[-1]["time_mjd"]) / 2
    return round(2000.0 + (middle - _MJD_J2000) / _DAYS_PER_JULIAN_YEAR, _EPOCH_DECIMALS)


async def write_catalog(output: Path, entry: dict, service: SkyCatalogs) -> dict | None:
    """Write the catalog file of one target and give what the index says about it.

    The file holds what other telescopes know inside the view of the bundles, at the
    middle of the dates of their frames. None when the target has no frame.
    """
    epoch = _middle_of_the_visits(output, entry)
    if epoch is None:
        return None
    grid = entry["grid"]
    view = Grid(ra=grid["ra"], dec=grid["dec"], fov_deg=grid["fov_deg"], size=grid["size"])
    found = catalogs_out(view, epoch, await view_catalogs(service, view, epoch)).model_dump()
    name = f"{entry['key']}-catalog.json"
    size_bytes = _write(
        output / name,
        {"format": CATALOG_FORMAT, "version": FORMAT_VERSION, "generated": _now(), **found},
    )
    counts = {catalog["key"]: len(catalog["sources"]) for catalog in found["catalogs"]}
    logger.info("%s: %s, %s", entry["key"], name, counts)
    return {"file": name, "sources": counts, "bytes": size_bytes}


async def rebuild_catalogs(output: Path, keys: Sequence[str], service: SkyCatalogs) -> None:
    """Write again the catalog files of targets whose bundles are already there.

    Only the catalog service is asked: no frame is downloaded.
    """
    index = json.loads((output / INDEX_FILE).read_text(encoding="utf-8"))
    for entry in index["targets"]:
        if keys and entry["key"] not in keys:
            continue
        catalog = await write_catalog(output, entry, service)
        if catalog is not None:
            write_index(output, [{"key": entry["key"], "catalog": catalog}])


def _catalog_service(client: httpx2.AsyncClient, settings: Settings) -> VizierCatalogs:
    return VizierCatalogs(
        client,
        urls=settings.catalog_url_list,
        timeout_s=settings.catalog_timeout_s,
        limit=settings.catalog_limit,
    )


async def run_catalogs(settings: Settings, output: Path, keys: Sequence[str]) -> None:
    async with httpx2.AsyncClient(
        headers={"User-Agent": f"spherex-explorer/{__version__}"}
    ) as client:
        await rebuild_catalogs(output, keys, _catalog_service(client, settings))


async def _write_spectrum(
    wanted: BundleTarget,
    target: Target,
    target_out: dict,
    archive: ExposureArchive,
    frames: FrameSource,
    output: Path,
    sleep,
) -> dict:
    """Write the spectrum file of one target and give what the index says about it."""
    for attempt in range(1, _FRAME_ATTEMPTS + 1):
        try:
            spectrum = await measure_spectrum(archive, frames, target)
            break
        except UpstreamUnavailable as exc:
            if attempt == _FRAME_ATTEMPTS:
                raise
            logger.warning("%s: spectrum: %s, attempt %d", wanted.name, exc, attempt)
            await sleep(_FRAME_PAUSE_S)
    points = [point_out(point).model_dump(by_alias=True) for point in spectrum.points]
    name = f"{wanted.key}-spectrum.json"
    size_bytes = _write(
        output / name,
        {
            "format": SPECTRUM_FORMAT,
            "version": FORMAT_VERSION,
            "generated": _now(),
            "target": target_out,
            "points": points,
        },
    )
    with_flux = sum(1 for point in points if point["flux_mjy"] is not None)
    logger.info("%s: %s, %d points, %d with a flux", wanted.name, name, len(points), with_flux)
    return {"file": name, "points": len(points), "with_flux": with_flux, "bytes": size_bytes}


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
    for entry in entries:
        # An entry built in part, such as a spectrum alone, completes the one already there.
        known[entry["key"]] = {**known.get(entry["key"], {}), **entry}
    order = {wanted.key: rank for rank, wanted in enumerate(EVERY_TARGET)}
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


async def run(
    settings: Settings,
    output: Path,
    keys: Sequence[str],
    parallel: int,
    with_frames: bool = True,
) -> None:
    wanted = [target for target in EVERY_TARGET if not keys or target.key in keys]
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
        catalogs = _catalog_service(client, settings)
        for target in wanted:
            entry = await build_target(
                target,
                resolver=resolver,
                archive=archive,
                frames=frames,
                output=output,
                parallel=parallel,
                with_frames=with_frames,
            )
            # The index is written after each target: a run cut short keeps what it built.
            write_index(output, [entry])
            if with_frames:
                try:
                    catalog = await write_catalog(output, entry, catalogs)
                except (UpstreamError, UpstreamUnavailable) as exc:
                    # The catalogs are an overlay: their file can be built later.
                    logger.warning("%s: no catalog file: %s", target.key, exc)
                else:
                    if catalog is not None:
                        write_index(output, [{"key": target.key, "catalog": catalog}])


async def write_journal(output: Path, fields: Sequence[JournalField], measure) -> int:
    """Write the journal: the findings of the fields given, in their order.

    A field with static files is read from its candidates file. Any other is measured:
    `measure(field)` gives the answer of `candidates` for it. A field that cannot be
    measured is left out, and so is one that shows nothing today.
    """
    entries: list[dict] = []
    for field in fields:
        measured = _now()
        try:
            if field.preset is not None:
                path = output / f"{field.preset}-candidates.json"
                report = json.loads(path.read_text(encoding="utf-8"))
                measured = report["generated"]
            else:
                report = await measure(field)
        except (OSError, ValueError, KeyError, NotFound, UpstreamError, UpstreamUnavailable) as exc:
            logger.warning("%s: left out of the journal: %s", field.key, exc)
            continue
        found = entries_of(field, report, measured[:10])
        logger.info("%s: %d entries", field.key, len(found))
        entries += found
    _write(
        output / JOURNAL_FILE,
        {
            "format": JOURNAL_FORMAT,
            "version": FORMAT_VERSION,
            "generated": _now(),
            "entries": entries,
        },
    )
    return len(entries)


async def run_journal(settings: Settings, output: Path) -> None:
    """Measure the fields of the journal with the code of the service, and write it."""
    limits = httpx2.Limits(
        max_connections=settings.storage_concurrency + 8,
        max_keepalive_connections=settings.storage_concurrency,
    )
    async with httpx2.AsyncClient(
        timeout=settings.archive_timeout_s,
        limits=limits,
        headers={"User-Agent": f"spherex-explorer/{__version__}"},
    ) as client:
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

        async def measure(field: JournalField) -> dict:
            report = await find_field_candidates(archive, frames, field.target)
            return candidates_out(report).model_dump(by_alias=True)

        count = await write_journal(output, JOURNAL_FIELDS, measure)
        logger.info("%s: %d entries", JOURNAL_FILE, count)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the files of the test targets.")
    parser.add_argument("--output", type=Path, required=True, help="Folder the files go to.")
    parser.add_argument(
        "--target",
        action="append",
        default=[],
        choices=[target.key for target in EVERY_TARGET],
        help="Target to build. Repeat it for several. All of them when left out.",
    )
    parser.add_argument("--parallel", type=int, default=16, help="Frames built at once.")
    parser.add_argument(
        "--spectra-only",
        action="store_true",
        help="Build the spectrum files only, and leave the bundles as they are.",
    )
    parser.add_argument(
        "--candidates-only",
        action="store_true",
        help="Build the candidates files only, from the bundles already there. No download.",
    )
    parser.add_argument(
        "--catalogs-only",
        action="store_true",
        help="Build the catalog files only, for the views of the bundles already there.",
    )
    parser.add_argument(
        "--journal",
        action="store_true",
        help="Build the journal only: the findings of the fields the search was checked on.",
    )
    arguments = parser.parse_args(argv)
    if not arguments.output.is_dir():
        parser.error(f"{arguments.output} is not a folder")
    if arguments.parallel < 1:
        parser.error("--parallel must be at least 1")
    partial = (
        arguments.spectra_only,
        arguments.candidates_only,
        arguments.catalogs_only,
        arguments.journal,
    )
    if sum(partial) > 1:
        parser.error(
            "--spectra-only, --candidates-only, --catalogs-only and --journal cannot go together"
        )

    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx2").setLevel("WARNING")
    if arguments.candidates_only:
        if not (arguments.output / INDEX_FILE).is_file():
            parser.error(f"{arguments.output} has no {INDEX_FILE}: build the bundles first")
        rebuild_candidates(arguments.output, arguments.target)
        return 0
    try:
        if arguments.journal:
            asyncio.run(run_journal(get_settings(), arguments.output))
            return 0
        if arguments.catalogs_only:
            if not (arguments.output / INDEX_FILE).is_file():
                parser.error(f"{arguments.output} has no {INDEX_FILE}: build the bundles first")
            asyncio.run(run_catalogs(get_settings(), arguments.output, arguments.target))
            return 0
        asyncio.run(
            run(
                get_settings(),
                arguments.output,
                arguments.target,
                arguments.parallel,
                with_frames=not arguments.spectra_only,
            )
        )
    except (NotFound, UpstreamError, UpstreamUnavailable) as exc:
        logger.error("Stopped: %s", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
