FROM denoland/deno:bin-2.8.3 AS deno

FROM python:3.12-slim-bookworm AS worker-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deno /deno /usr/local/bin/deno

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

RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && python -c "from shorts_worker.editor_renderer import verify_editor_fonts; verify_editor_fonts()"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["python", "-m", "shorts_worker"]
