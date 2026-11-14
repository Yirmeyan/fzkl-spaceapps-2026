"""Pipeline: orchestrates one request across the archive, the targets and the frames."""

from spherex_explorer.pipeline.candidates import (
    FieldReport,
    field_frame,
    find_field_candidates,
    report_field,
)
from spherex_explorer.pipeline.exposures import (
    ExposureArchive,
    ExposureListing,
    ListedExposure,
    list_exposures,
    number_passes,
)
from spherex_explorer.pipeline.frames import Frame, FrameSource, build_frame
from spherex_explorer.pipeline.spectrum import (
    Spectrum,
    SpectrumPoint,
    measure_exposure,
    measure_spectrum,
)

__all__ = [
    "ExposureArchive",
    "ExposureListing",
    "FieldReport",
    "Frame",
    "FrameSource",
    "ListedExposure",
    "Spectrum",
    "SpectrumPoint",
    "build_frame",
    "field_frame",
    "find_field_candidates",
    "list_exposures",
    "measure_exposure",
    "measure_spectrum",
    "number_passes",
    "report_field",
]
