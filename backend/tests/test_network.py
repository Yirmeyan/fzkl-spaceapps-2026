"""Tests that call the real archive. Run them on demand: uv run python -m pytest -m network"""

import asyncio
import base64
import io

import httpx2
import numpy as np
import pytest
from astropy.io import fits

from conftest import BARNARD
from spherex_explorer.archive import Level2Reader, S3Reader, SiaArchive, Window, key_from_id
from spherex_explorer.catalogs import CATALOGS, VizierCatalogs
from spherex_explorer.config import Settings
from spherex_explorer.frames import Grid
from spherex_explorer.pipeline import build_frame, list_exposures
from spherex_explorer.targets import SesameResolver, Target

pytestmark = pytest.mark.network


def real_listing(target: Target):
    settings = Settings(_env_file=None)

    async def run():
        async with httpx2.AsyncClient() as client:
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
            return await list_exposures(archive, target, fov_deg=0.1, size=128)

    return asyncio.run(run())


def test_barnards_star_in_the_real_archive(sample_bundle):
    listing = real_listing(Target(**BARNARD))

    assert len(listing.exposures) >= 364
    assert {item.exposure.detector for item in listing.exposures} == {1, 2, 3, 4, 5, 6}
    assert max(item.pass_number for item in listing.exposures) >= 3
    found = {item.exposure.id for item in listing.exposures}
    assert {entry["id"] for entry in sample_bundle["exposures"]} <= found
    assert listing.grid.ra == pytest.approx(sample_bundle["grid"]["ra"], abs=1e-4)
    assert listing.grid.dec == pytest.approx(sample_bundle["grid"]["dec"], abs=1e-4)


def test_window_of_a_real_file_is_identical_to_the_cutout_of_the_archive():
    """The archive cuts the same exposure itself: its pixels are the reference."""
    exposure_id = "dr1.2025W34_2B_0090_4D2.l2b-v27-2026-229"
    cutout_url = (
        f"https://irsa.ipac.caltech.edu/ibe/data/spherex/{key_from_id(exposure_id)}"
        "?center=269.44623,4.768703&size=0.1"
    )
    settings = Settings(_env_file=None)

    async def run():
        async with httpx2.AsyncClient(timeout=60, follow_redirects=True) as client:
            # The cutout service refuses requests in bursts: give it a few chances.
            for _ in range(5):
                response = await client.get(cutout_url)
                if response.status_code not in (502, 503):
                    break
                await asyncio.sleep(4)
            response.raise_for_status()
            reader = Level2Reader(
                S3Reader(
                    client,
                    base_url=settings.storage_url,
                    timeout_s=settings.storage_timeout_s,
                    attempts=settings.storage_attempts,
                    concurrency=settings.storage_concurrency,
                )
            )
            layout = await reader.layout(exposure_id)
            with fits.open(io.BytesIO(response.content)) as cutout:
                image = cutout["IMAGE"]
                # A cutout keeps the sky coordinates of the file and moves their reference
                # pixel: the shift is the corner of the cutout in the full image.
                x0 = layout.header["CRPIX1"] - image.header["CRPIX1"]
                y0 = layout.header["CRPIX2"] - image.header["CRPIX2"]
                assert x0 == round(x0) and y0 == round(y0)
                height, width = image.data.shape
                window = Window(round(x0), round(y0), round(x0) + width, round(y0) + height)
                raw = await reader.read_window(exposure_id, window)
                table = await reader.wavelength_table(exposure_id)
                expected = cutout["WCS-WAVE"].data

                assert width >= 50 and height >= 50
                assert np.array_equal(raw.image, image.data, equal_nan=True)
                assert np.array_equal(raw.variance, cutout["VARIANCE"].data, equal_nan=True)
                assert np.array_equal(raw.flags, cutout["FLAGS"].data)
                assert np.array_equal(table.x, expected["X"][0])
                assert np.array_equal(table.y, expected["Y"][0])
                assert np.array_equal(table.values, expected["VALUES"][0])

    asyncio.run(run())


def test_frame_of_a_real_exposure_is_the_one_of_the_sample_of_the_contract(sample_bundle):
    """The sample was made by a prototype checked on catalog stars: the service must agree."""
    expected = sample_bundle["frames"][0]
    grid = Grid(**{key: sample_bundle["grid"][key] for key in ("ra", "dec", "fov_deg", "size")})
    settings = Settings(_env_file=None)

    async def run():
        async with httpx2.AsyncClient(timeout=30) as client:
            reader = Level2Reader(
                S3Reader(
                    client,
                    base_url=settings.storage_url,
                    timeout_s=settings.storage_timeout_s,
                    attempts=settings.storage_attempts,
                    concurrency=settings.storage_concurrency,
                )
            )
            return await build_frame(reader, expected["id"], Target(**BARNARD), grid)

    frame = asyncio.run(run())
    image = np.frombuffer(base64.b64decode(expected["image"]), dtype="<f2").astype(np.float32)
    image = image.reshape(grid.size, grid.size)
    mask = np.frombuffer(base64.b64decode(expected["mask"]), dtype=np.uint8)
    mask = mask.reshape(grid.size, grid.size)

    assert frame.time_mjd == pytest.approx(expected["time_mjd"], abs=1e-6)
    assert frame.exposure_s == pytest.approx(expected["exposure_s"], abs=0.05)
    assert frame.wavelength_um == pytest.approx(expected["wavelength_um"], abs=1e-4)
    assert frame.bandwidth_um == pytest.approx(expected["bandwidth_um"], abs=1e-4)
    assert frame.target_xy == pytest.approx(expected["target_xy"], abs=0.006)
    assert frame.valid_fraction == pytest.approx(expected["valid_fraction"], abs=0.006)
    assert frame.photometry.quality == expected["photometry"]["quality"]
    # The prototype approximated the geometry to 0.02 pixel and took its background
    # from other pixels: a few pixels near the saturated star and the two summaries differ.
    assert frame.background == pytest.approx(expected["background"], rel=0.05)
    assert frame.noise == pytest.approx(expected["noise"], rel=0.15)
    assert np.count_nonzero(np.isnan(frame.image) != np.isnan(image)) <= 4
    assert np.count_nonzero(frame.mask != mask) <= 20
    both = np.isfinite(frame.image) & np.isfinite(image)
    relative = np.abs(frame.image - image)[both] / np.maximum(np.abs(image[both]), 1e-6)
    assert np.median(relative) < 0.002
    assert np.percentile(relative, 99) < 0.03


def test_barnards_star_is_resolved_to_the_target_of_the_sample():
    settings = Settings(_env_file=None)

    async def run():
        async with httpx2.AsyncClient() as client:
            resolver = SesameResolver(
                client, urls=settings.resolver_url_list, timeout_s=settings.resolver_timeout_s
            )
            return await resolver.resolve("Barnard's Star")

    target = asyncio.run(run())

    assert (target.ra, target.dec) == pytest.approx((BARNARD["ra"], BARNARD["dec"]), abs=1e-5)
    assert target.epoch == BARNARD["epoch"]
    assert target.pm_ra == pytest.approx(BARNARD["pm_ra"], abs=0.5)
    assert target.pm_dec == pytest.approx(BARNARD["pm_dec"], abs=0.5)


def test_barnards_star_is_the_brightest_source_of_gaia_and_of_allwise_around_it():
    settings = Settings(_env_file=None)

    async def run():
        async with httpx2.AsyncClient() as client:
            service = VizierCatalogs(
                client, urls=settings.catalog_url_list, timeout_s=settings.catalog_timeout_s
            )
            return [await service.around(catalog, 269.4485, 4.7394, 0.05) for catalog in CATALOGS]

    gaia, allwise = asyncio.run(run())

    star = gaia.sources[0]
    assert star.id == "Gaia DR3 4472832130942575872"
    assert (star.pm_ra, star.pm_dec) == pytest.approx((-801.551, 10362.394), abs=0.01)
    assert star.parallax == pytest.approx(546.98, abs=0.01)
    assert dict(star.magnitudes)["G"] == pytest.approx(8.19, abs=0.01)
    # WISE saw it five and a half years earlier, 58 arcseconds to the south.
    seen = allwise.sources[0]
    assert seen.id == "J175747.94+044323.8"
    assert (star.dec - seen.dec) * 3600 == pytest.approx(5.6 * 10.36, abs=4.0)
    assert dict(seen.magnitudes)["W2"] < 5
