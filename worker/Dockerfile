FROM denoland/deno:alpine-2.8.3 AS deno

FROM python:3.12-alpine3.22 AS worker-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apk add --no-cache bash ffmpeg libgcc libstdc++

COPY --from=deno /bin/deno /usr/local/bin/deno
COPY --from=deno /lib64/ld-linux-x86-64.so.2 /lib64/ld-linux-x86-64.so.2
COPY --from=deno /usr/local/lib/glibc /usr/local/lib/glibc

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
