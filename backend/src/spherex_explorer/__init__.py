"""Service that reads SPHEREx exposures and serves aligned frames."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("spherex-explorer")
except PackageNotFoundError:
    # The package is imported from a source tree that was never installed.
    __version__ = "0.0.0+unknown"
