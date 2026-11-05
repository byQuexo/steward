from pathlib import Path

import pytest

from steward_eval.data import load_profile
from steward_eval.pii import PiiDetector

PROFILE_DIR = Path(__file__).resolve().parents[2] / "profiles" / "acme"


@pytest.fixture(scope="session")
def profile():
    return load_profile(PROFILE_DIR)


@pytest.fixture(scope="session")
def pii(profile):
    return PiiDetector(profile)
