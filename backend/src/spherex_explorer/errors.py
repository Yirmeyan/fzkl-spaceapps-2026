"""Failures of the outside services this one depends on."""


class UpstreamError(Exception):
    """An outside service answered something this service cannot use.

    It points to a bug here or to a change over there. Waiting does not help.
    """


class UpstreamUnavailable(Exception):
    """An outside service did not answer. The same request may succeed later."""

    def __init__(self, service: str, reason: str, retry_after_s: int) -> None:
        super().__init__(f"{service} is unavailable: {reason}")
        self.service = service
        self.reason = reason
        self.retry_after_s = retry_after_s


class NotFound(Exception):
    """What was asked for does not exist. Asking again does not help.

    `public` is the sentence a client may read. The rest stays in the logs.
    """

    def __init__(self, detail: str, public: str) -> None:
        super().__init__(detail)
        self.public = public
