FROM python:3.12-alpine3.22@sha256:a190708a2dec1bd18b1decb539f8e8f5407abaa9bf39cacda583f7f8c11db322 AS worker-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

USER 0
RUN apk add --no-cache \
        bash \
        coreutils \
        deno \
        ffmpeg \
        libstdc++ \
        openssl=3.5.7-r0

WORKDIR /app/worker
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && deno --version \
    && python -c "from importlib.metadata import version; assert version('yt-dlp') == '2026.7.4'; assert version('yt-dlp-ejs') == '0.8.0'"
COPY . .

FROM worker-base AS prepare

ENTRYPOINT ["./entrypoint.sh"]
CMD ["python", "-m", "shorts_worker"]

FROM worker-base AS render

RUN apk add --no-cache font-noto-cjk \
    && python -c "from shorts_worker.editor_renderer import verify_editor_fonts; verify_editor_fonts()"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["python", "-m", "shorts_worker"]
