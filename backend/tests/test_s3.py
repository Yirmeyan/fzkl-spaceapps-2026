import asyncio
import re

import httpx2
import numpy as np
import pytest

from level2_file import EXPOSURE_ID, KEY, build_level2_file, reference
from spherex_explorer.archive import Level2Reader, S3Reader, Window
from spherex_explorer.errors import NotFound, UpstreamError, UpstreamUnavailable

BASE = "https://bucket.example"
CONTENT = bytes(range(256)) * 40


class Storage:
    """Stands for S3: serves ranges of one file, or the answers queued in advance."""

    def __init__(self, content: bytes = CONTENT, answers=(), delay_s: float = 0.0):
        self.content = content
        self.answers = list(answers)
        self.delay_s = delay_s
        self.requests: list[httpx2.Request] = []
        self.pauses: list[float] = []
        self.active = 0
        self.most_active = 0

    async def handle(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        self.active += 1
        self.most_active = max(self.most_active, self.active)
        try:
            if self.delay_s:
                await asyncio.sleep(self.delay_s)
            if self.answers:
                answer = self.answers.pop(0)
                if isinstance(answer, Exception):
                    raise answer
                if answer is not None:
                    return answer
            return self.serve(request)
        finally:
            self.active -= 1

    def serve(self, request: httpx2.Request) -> httpx2.Response:
        first, last = re.fullmatch(r"bytes=(\d*)-(\d*)", request.headers["Range"]).groups()
        size = len(self.content)
        if first == "":
            start, end = size - int(last), size
        else:
            start, end = int(first), min(int(last) + 1, size)
        return httpx2.Response(
            206,
            content=self.content[start:end],
            headers={"Content-Range": f"bytes {start}-{end - 1}/{size}"},
        )

    async def sleep(self, seconds: float) -> None:
        self.pauses.append(seconds)


def run(storage: Storage, action, attempts: int = 3, concurrency: int = 8):
    async def main():
        transport = httpx2.MockTransport(storage.handle)
        async with httpx2.AsyncClient(transport=transport) as client:
            reader = S3Reader(
                client,
                base_url=BASE + "/",
                timeout_s=10.0,
                attempts=attempts,
                concurrency=concurrency,
                sleep=storage.sleep,
            )
            return await action(reader)

    return asyncio.run(main())


def busy() -> httpx2.Response:
    return httpx2.Response(503, text="SlowDown")


def test_read_asks_for_the_range_of_the_file_and_nothing_else():
    storage = Storage()

    data = run(storage, lambda reader: reader.read("dr1/level2/a.fits", 100, 50))

    assert data == CONTENT[100:150]
    request = storage.requests[0]
    assert str(request.url) == f"{BASE}/dr1/level2/a.fits"
    assert request.headers["Range"] == "bytes=100-149"


def test_read_tail_asks_for_the_last_bytes():
    storage = Storage()

    data = run(storage, lambda reader: reader.read_tail("a.fits", 64))

    assert data == CONTENT[-64:]
    assert storage.requests[0].headers["Range"] == "bytes=-64"


def test_read_past_the_end_gives_what_is_left():
    storage = Storage()

    data = run(storage, lambda reader: reader.read("a.fits", len(CONTENT) - 10, 500))

    assert data == CONTENT[-10:]


@pytest.mark.parametrize(("start", "length"), [(-1, 10), (0, 0), (5, -3)])
def test_range_that_makes_no_sense_is_refused_without_a_request(start, length):
    storage = Storage()

    with pytest.raises(ValueError):
        run(storage, lambda reader: reader.read("a.fits", start, length))
    with pytest.raises(ValueError):
        run(storage, lambda reader: reader.read_tail("a.fits", 0))

    assert storage.requests == []


def test_missing_file_is_not_found_and_not_asked_again():
    storage = Storage(answers=[httpx2.Response(404, text="NoSuchKey")])

    with pytest.raises(NotFound, match=r"a\.fits"):
        run(storage, lambda reader: reader.read("a.fits", 0, 10))

    assert len(storage.requests) == 1


def test_busy_storage_is_asked_again_after_growing_pauses():
    storage = Storage(answers=[busy(), httpx2.Response(500), None])

    data = run(storage, lambda reader: reader.read("a.fits", 0, 10))

    assert data == CONTENT[:10]
    assert len(storage.requests) == 3
    assert storage.pauses == [0.2, 0.4]


@pytest.mark.parametrize(
    "failure",
    [busy(), httpx2.ReadTimeout("too slow"), httpx2.ConnectError("no route")],
)
def test_storage_that_keeps_failing_is_reported_as_unavailable(failure):
    storage = Storage(answers=[failure, failure, failure])

    with pytest.raises(UpstreamUnavailable) as error:
        run(storage, lambda reader: reader.read("a.fits", 0, 10))

    assert error.value.retry_after_s == 5
    assert len(storage.requests) == 3
    assert storage.pauses == [0.2, 0.4]


@pytest.mark.parametrize("status", [200, 403, 416])
def test_unexpected_answer_is_an_error_and_not_asked_again(status):
    storage = Storage(answers=[httpx2.Response(status, content=CONTENT)])

    with pytest.raises(UpstreamError, match=f"HTTP {status}"):
        run(storage, lambda reader: reader.read("a.fits", 0, 10))

    assert len(storage.requests) == 1


def test_no_more_reads_are_in_flight_than_the_limit():
    storage = Storage(delay_s=0.01)

    async def many(reader):
        return await asyncio.gather(*(reader.read("a.fits", index, 10) for index in range(24)))

    results = run(storage, many, concurrency=4)

    assert len(results) == 24
    assert storage.most_active == 4


def test_window_read_through_http_is_identical_to_what_astropy_reads():
    content = build_level2_file()
    expected = reference(content)
    storage = Storage(content=content)

    async def window(reader):
        level2 = Level2Reader(reader)
        return await level2.read_window(EXPOSURE_ID, Window(10, 20, 40, 50))

    raw = run(storage, window)

    assert np.array_equal(raw.image, expected["IMAGE"].data[20:50, 10:40], equal_nan=True)
    assert np.array_equal(raw.variance, expected["VARIANCE"].data[20:50, 10:40])
    assert np.array_equal(raw.flags, expected["FLAGS"].data[20:50, 10:40])
    assert {str(request.url) for request in storage.requests} == {f"{BASE}/{KEY}"}
