"""Reads of parts of a file in the public storage of the SPHEREx archive.

The storage is Amazon S3. It serves any range of bytes of a file over plain HTTPS,
without an account, so a 60 MB file never has to be downloaded whole.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Protocol

import httpx2

from spherex_explorer.errors import NotFound, UpstreamError, UpstreamUnavailable

logger = logging.getLogger(__name__)

_SERVICE = "The SPHEREx file storage"
_PARTIAL_CONTENT = 206
_NOT_FOUND = 404
# Statuses that mean "busy, try again", as opposed to "this request is wrong".
_RETRYABLE_STATUSES = frozenset({500, 502, 503, 504})
# The storage recovers fast: the pauses are short and double at each attempt.
_FIRST_PAUSE_S = 0.2
# Delay a client is asked to wait before it sends the same request again.
_CLIENT_RETRY_AFTER_S = 5
_NO_SUCH_EXPOSURE = "The archive has no such exposure."


class RangeReader(Protocol):
    """What the file reader needs from a storage. Tests provide their own."""

    async def read(self, key: str, start: int, length: int) -> bytes: ...

    async def read_tail(self, key: str, length: int) -> bytes: ...


class S3Reader:
    """Reads ranges of bytes, a few at a time, and tries again when the storage is busy."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        *,
        base_url: str,
        timeout_s: float,
        attempts: int,
        concurrency: int,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._client = client
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s
        self._attempts = attempts
        self._sleep = sleep
        # One view asks for hundreds of ranges at once. The limit keeps this service
        # a polite client and its own connections under control.
        self._slots = asyncio.Semaphore(concurrency)

    async def read(self, key: str, start: int, length: int) -> bytes:
        """Up to `length` bytes of a file from `start`. Fewer only at the end of the file."""
        if start < 0 or length <= 0:
            raise ValueError(f"not a range of bytes: start {start}, length {length}")
        return await self._get(key, f"bytes={start}-{start + length - 1}")

    async def read_tail(self, key: str, length: int) -> bytes:
        """The last `length` bytes of a file."""
        if length <= 0:
            raise ValueError(f"not a number of bytes: {length}")
        return await self._get(key, f"bytes=-{length}")

    async def _get(self, key: str, byte_range: str) -> bytes:
        url = f"{self._base_url}/{key}"
        reason = ""
        for attempt in range(1, self._attempts + 1):
            async with self._slots:
                outcome = await self._once(url, key, byte_range)
            if isinstance(outcome, bytes):
                return outcome
            reason = outcome
            logger.warning(
                "%s: attempt %d of %d failed: %s", _SERVICE, attempt, self._attempts, reason
            )
            if attempt < self._attempts:
                await self._sleep(_FIRST_PAUSE_S * 2 ** (attempt - 1))
        raise UpstreamUnavailable(_SERVICE, reason, retry_after_s=_CLIENT_RETRY_AFTER_S)

    async def _once(self, url: str, key: str, byte_range: str) -> bytes | str:
        """One attempt: the bytes, or the reason to try again."""
        try:
            # The answer is streamed so that its status is known before its body. A
            # storage that ignored the range would otherwise send the whole file.
            async with self._client.stream(
                "GET", url, headers={"Range": byte_range}, timeout=self._timeout_s
            ) as response:
                status = response.status_code
                if status == _PARTIAL_CONTENT:
                    return await response.aread()
        except httpx2.TimeoutException:
            return "no answer within the time limit"
        except httpx2.TransportError as exc:
            return f"connection failed ({type(exc).__name__})"
        if status == _NOT_FOUND:
            raise NotFound(f"no file {key!r} in the archive", public=_NO_SUCH_EXPOSURE)
        if status in _RETRYABLE_STATUSES:
            return f"HTTP {status}"
        raise UpstreamError(f"{_SERVICE} answered HTTP {status} to a request for {byte_range}")
