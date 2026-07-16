class ShortsMakerError(Exception):
    """Expected application error safe to show to a user."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class InvalidYouTubeUrl(ShortsMakerError):
    pass


class IngestionError(ShortsMakerError):
    """A classified ingestion failure that is safe to persist for operators."""

    default_code = "ingestion_unknown"
    retryable = False

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        details: dict[str, object] | None = None,
        status_code: int = 400,
    ) -> None:
        super().__init__(message, status_code=status_code)
        self.code = (code or self.default_code)[:100]
        self.details = dict(details or {})

    def failure_details(self) -> dict[str, object]:
        result: dict[str, object] = {
            **self.details,
            "category": "ingestion",
            "exception_type": type(self).__name__,
            "reason": self.message[:1000],
            "retryable": self.retryable,
        }
        cause = self.__cause__
        if isinstance(cause, IngestionError):
            result["cause"] = {
                "code": cause.code,
                **cause.failure_details(),
            }
        elif cause is not None:
            result["cause_exception_type"] = type(cause).__name__
        return result


class RetryableIngestionError(IngestionError):
    """A temporary acquisition failure that can succeed on a later attempt."""

    default_code = "ingestion_temporary_failure"
    retryable = True


class RetryExhaustedIngestionError(IngestionError):
    """A temporary acquisition failure that exhausted its bounded retries."""

    default_code = "ingestion_retry_exhausted"


class BotCheckError(IngestionError):
    """YouTube rejected the worker egress as automated traffic."""

    default_code = "youtube_bot_challenge"
    retryable = True


class TranscriptionError(ShortsMakerError):
    """Required audio transcription failed or produced no usable text."""


class RenderError(ShortsMakerError):
    pass
