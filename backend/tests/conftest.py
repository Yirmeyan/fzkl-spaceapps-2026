import gzip
import json
from pathlib import Path

import pytest

DATA = Path(__file__).parent / "data"
REPOSITORY = Path(__file__).parents[2]

# Barnard's Star as the CDS resolver gives it, the target of the sample file.
BARNARD = {
    "ra": 269.452077,
    "dec": 4.693365,
    "epoch": 2000.0,
    "pm_ra": -801.551,
    "pm_dec": 10362.394,
}


@pytest.fixture(scope="session")
def sia_payload() -> bytes:
    """Answer of the IRSA exposure search for Barnard's Star, recorded on November 14, 2026."""
    return gzip.decompress((DATA / "sia_barnard_star.xml.gz").read_bytes())


@pytest.fixture(scope="session")
def sample_bundle() -> dict:
    """The sample file of the API contract: Barnard's Star, detector 2."""
    path = REPOSITORY / "samples" / "barnard-star-d2.json"
    return json.loads(path.read_text(encoding="utf-8"))
