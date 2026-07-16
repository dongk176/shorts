class ShortsMakerError(Exception):
    """Expected application error safe to show to a user."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class InvalidYouTubeUrl(ShortsMakerError):
    pass


class IngestionError(ShortsMakerError):
    pass


class RetryableIngestionError(IngestionError):
    """A temporary acquisition failure that can succeed on a later attempt."""


class RetryExhaustedIngestionError(IngestionError):
    """A temporary acquisition failure that exhausted its bounded retries."""


class BotCheckError(IngestionError):
    """YouTube rejected the worker egress as automated traffic."""


class TranscriptionError(ShortsMakerError):
    """Required audio transcription failed or produced no usable text."""


class RenderError(ShortsMakerError):
    pass
