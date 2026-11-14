import asyncio
import json
import re
from collections import Counter

import httpx2
import pytest

from spherex_explorer.archive import SiaArchive, key_from_id, parse_sia_response
from spherex_explorer.errors import UpstreamError, UpstreamUnavailable

BUCKET = "nasa-irsa-spherex"
URL = "https://archive.example/SIA"
COLLECTIONS = ["spherex_dr1", "spherex_qr3"]


def key(collection: str = "qr3", observation: str = "2026W33_2A_0594_3", detector: int = 6) -> str:
    version = "l2b-v27-2026-241"
    week = observation[:10]
    return (
        f"{collection}/level2/{week}/{version}/{detector}/"
        f"level2_{observation}D{detector}_spx_{version}.fits"
    )


def row(
    file_key: str, start: str = "61268.629319", end: str = "61268.630652", bucket: str = BUCKET
):
    access = json.dumps({"aws": {"bucket_name": bucket, "key": file_key, "region": "us-east-1"}})
    escaped = access.replace("&", "&amp;").replace('"', "&quot;")
    return f"<TR><TD>{start}</TD><TD>{end}</TD><TD>{escaped}</TD></TR>"


def votable(
    rows: list[str],
    status: str = "OK",
    detail: str = "",
    columns=("t_min", "t_max", "cloud_access"),
):
    fields = "".join(f'<FIELD name="{name}" datatype="char"/>' for name in columns)
    return (
        '<?xml version="1.0"?>'
        '<VOTABLE version="1.3" xmlns="http://www.ivoa.net/xml/VOTable/v1.3">'
        '<RESOURCE type="meta"/>'
        '<RESOURCE type="results">'
        f'<INFO name="QUERY_STATUS" value="{status}">{detail}</INFO>'
        f"<TABLE>{fields}<DATA><TABLEDATA>{''.join(rows)}</TABLEDATA></DATA></TABLE>"
        "</RESOURCE></VOTABLE>"
    ).encode()


# Reading an answer


def test_recorded_answer_gives_every_exposure_of_barnards_star(sia_payload):
    result = parse_sia_response(sia_payload, bucket=BUCKET)

    assert len(result.exposures) == 364
    assert result.skipped == 0
    assert not result.truncated
    assert len({exposure.id for exposure in result.exposures}) == 364
    assert Counter(exposure.detector for exposure in result.exposures) == {
        1: 60,
        2: 62,
        3: 61,
        4: 59,
        5: 62,
        6: 60,
    }
    assert Counter(exposure.collection for exposure in result.exposures) == {"dr1": 240, "qr3": 124}


def test_every_recorded_file_address_is_rebuilt_from_its_identifier(sia_payload):
    recorded = set(re.findall(r"&quot;key&quot;:&quot;([^&]+)&quot;", sia_payload.decode()))
    result = parse_sia_response(sia_payload, bucket=BUCKET)

    assert len(recorded) == 364
    assert {key_from_id(exposure.id) for exposure in result.exposures} == recorded


def test_date_is_the_middle_of_the_exposure():
    result = parse_sia_response(votable([row(key(), "61268.0", "61268.5")]), bucket=BUCKET)

    assert result.exposures[0].time_mjd == 61268.25


def test_empty_table_is_an_empty_list():
    result = parse_sia_response(votable([]), bucket=BUCKET)

    assert result.exposures == ()
    assert not result.truncated


def test_overflow_is_reported():
    result = parse_sia_response(votable([row(key())], status="OVERFLOW"), bucket=BUCKET)

    assert result.truncated
    assert len(result.exposures) == 1


def test_unreadable_row_is_skipped_and_counted():
    rows = [
        row(key()),
        row(key(), bucket="another-bucket"),
        row("somewhere/else.fits"),
        row(key(observation="2026W33_2A_0595_1"), start="not a number"),
        row(key(observation="2026W33_2A_0596_1"), start="nan"),
    ]

    result = parse_sia_response(votable(rows), bucket=BUCKET)

    assert len(result.exposures) == 1
    assert result.skipped == 4


def test_answer_where_no_row_can_be_read_is_an_error():
    with pytest.raises(UpstreamError, match="none could be read"):
        parse_sia_response(votable([row(key(), bucket="renamed-bucket")]), bucket=BUCKET)


def test_error_status_is_an_error_with_its_reason():
    payload = votable([], status="ERROR", detail="UsageFault: BAD_REQUEST")

    with pytest.raises(UpstreamError, match="BAD_REQUEST"):
        parse_sia_response(payload, bucket=BUCKET)


@pytest.mark.parametrize(
    "payload",
    [
        b"<html>Service temporarily down</html",
        b'<!DOCTYPE VOTABLE [<!ENTITY a "aaaa">]><VOTABLE><RESOURCE type="results"/></VOTABLE>',
        b'<VOTABLE xmlns="http://www.ivoa.net/xml/VOTable/v1.3"><RESOURCE type="meta"/></VOTABLE>',
        votable([row(key())], columns=("t_min", "t_max", "access_url")),
    ],
)
def test_answer_of_another_shape_is_an_error(payload):
    with pytest.raises(UpstreamError):
        parse_sia_response(payload, bucket=BUCKET)


# Calling the service


class Recorder:
    """Answers queued in advance, a clock that moves only when told, a trace of the requests."""

    def __init__(self, *answers, answer_time_s: float = 0.0):
        self.answers = list(answers)
        self.answer_time_s = answer_time_s
        self.now = 0.0
        self.requests: list[httpx2.Request] = []
        self.pauses: list[float] = []

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        self.now += self.answer_time_s
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    async def sleep(self, seconds: float) -> None:
        self.pauses.append(seconds)
        self.now += seconds

    def clock(self) -> float:
        return self.now


def search(recorder: Recorder, collections=COLLECTIONS, attempts: int = 3):
    async def run():
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(recorder.handle)) as client:
            archive = SiaArchive(
                client,
                url=URL,
                collections=collections,
                bucket=BUCKET,
                radius_deg=0.01,
                timeout_s=25.0,
                budget_s=45.0,
                attempts=attempts,
                max_exposures=5000,
                sleep=recorder.sleep,
                clock=recorder.clock,
            )
            return await archive.find_exposures(269.44623, 4.768703)

    return asyncio.run(run())


def ok(payload: bytes) -> httpx2.Response:
    return httpx2.Response(200, content=payload)


def busy(retry_after: str | None = "5") -> httpx2.Response:
    headers = {"Retry-After": retry_after} if retry_after is not None else {}
    return httpx2.Response(503, headers=headers, text="Server busy, retry later")


def test_query_names_the_releases_the_position_and_the_limit(sia_payload):
    recorder = Recorder(ok(sia_payload))

    exposures = search(recorder)

    assert len(exposures) == 364
    params = recorder.requests[0].url.params
    assert params.get_list("COLLECTION") == COLLECTIONS
    assert params["POS"] == "circle 269.4462300 4.7687030 0.01"
    assert params["MAXREC"] == "5000"
    assert recorder.pauses == []


def test_busy_archive_is_asked_again_after_a_bounded_pause():
    recorder = Recorder(busy("5"), ok(votable([row(key())])))

    exposures = search(recorder)

    assert len(exposures) == 1
    assert len(recorder.requests) == 2
    assert recorder.pauses == [3.0]


def test_archive_that_stays_busy_is_reported_as_unavailable():
    recorder = Recorder(busy(None), busy("soon"), busy("1"))

    with pytest.raises(UpstreamUnavailable) as failure:
        search(recorder)

    assert failure.value.retry_after_s == 10
    assert "HTTP 503" in failure.value.reason
    assert len(recorder.requests) == 3
    assert recorder.pauses == [1.0, 2.0]


@pytest.mark.parametrize(
    "failure",
    [httpx2.ReadTimeout("too slow"), httpx2.ConnectError("no route")],
)
def test_silent_archive_is_reported_as_unavailable(failure):
    recorder = Recorder(failure, failure, failure)

    with pytest.raises(UpstreamUnavailable):
        search(recorder)

    assert len(recorder.requests) == 3


def test_slow_archive_is_given_what_is_left_of_the_time_budget():
    slow = httpx2.ReadTimeout("too slow")
    recorder = Recorder(slow, slow, slow, answer_time_s=25.0)

    with pytest.raises(UpstreamUnavailable):
        search(recorder)

    # 25 s, a pause of 1 s, then only 19 s are left of the 45 s: no third attempt.
    waits = [request.extensions["timeout"]["read"] for request in recorder.requests]
    assert waits == [25.0, 19.0]


def test_refused_request_is_not_repeated():
    recorder = Recorder(httpx2.Response(400, text="bad request"))

    with pytest.raises(UpstreamError, match="HTTP 400"):
        search(recorder)

    assert len(recorder.requests) == 1


def test_exposure_published_twice_is_kept_from_the_preferred_release():
    payload = votable([row(key("qr3")), row(key("dr1")), row(key("qr3", detector=5))])

    preferred_dr1 = search(Recorder(ok(payload)), collections=["spherex_dr1", "spherex_qr3"])
    preferred_qr3 = search(Recorder(ok(payload)), collections=["spherex_qr3", "spherex_dr1"])

    assert sorted(e.id for e in preferred_dr1) == [
        "dr1.2026W33_2A_0594_3D6.l2b-v27-2026-241",
        "qr3.2026W33_2A_0594_3D5.l2b-v27-2026-241",
    ]
    assert sorted(e.id for e in preferred_qr3) == [
        "qr3.2026W33_2A_0594_3D5.l2b-v27-2026-241",
        "qr3.2026W33_2A_0594_3D6.l2b-v27-2026-241",
    ]
