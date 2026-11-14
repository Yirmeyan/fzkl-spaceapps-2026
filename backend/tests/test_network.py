"""Tests that call the real archive. Run them on demand: uv run python -m pytest -m network"""

import asyncio

import httpx2
import pytest

from conftest import BARNARD
from spherex_explorer.archive import SiaArchive
from spherex_explorer.config import Settings
from spherex_explorer.pipeline import list_exposures
from spherex_explorer.targets import Target

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
