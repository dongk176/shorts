FROM node:24-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a AS po-token-builder

USER 0
RUN apk add --no-cache \
        build-base \
        cairo-dev \
        giflib-dev \
        jpeg-dev \
        pango-dev \
        pkgconf \
        pixman-dev \
        python3

ADD --checksum=sha256:cbc8c2e54126ec38f4c2a278b3cab685d337cadc3e7f09762116e3b28be18b5f \
    https://codeload.github.com/Brainicism/bgutil-ytdlp-pot-provider/tar.gz/fbe4ed47f3b63cf061f1158f18f74bcc90e54033 \
    /tmp/bgutil-ytdlp-pot-provider.tar.gz
RUN mkdir -p /opt/bgutil-ytdlp-pot-provider \
    && tar -xzf /tmp/bgutil-ytdlp-pot-provider.tar.gz \
        --strip-components=1 -C /opt/bgutil-ytdlp-pot-provider \
    && cd /opt/bgutil-ytdlp-pot-provider/server \
    && npm ci --no-audit --no-fund \
    && ./node_modules/.bin/tsc \
    && npm prune --omit=dev --no-audit --no-fund \
    && node build/generate_once.js --version | grep -Fx '1.3.1'

FROM python:3.12-alpine3.22@sha256:a190708a2dec1bd18b1decb539f8e8f5407abaa9bf39cacda583f7f8c11db322 AS worker-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

USER 0
RUN apk add --no-cache \
        bash \
        cairo \
        coreutils \
        deno \
        ffmpeg \
        giflib \
        libjpeg-turbo \
        libstdc++ \
        openssl=3.5.7-r0 \
        pango \
        pixman

COPY --from=po-token-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=po-token-builder \
    /opt/bgutil-ytdlp-pot-provider/server/build \
    /opt/bgutil-ytdlp-pot-provider/server/build
COPY --from=po-token-builder \
    /opt/bgutil-ytdlp-pot-provider/server/node_modules \
    /opt/bgutil-ytdlp-pot-provider/server/node_modules
COPY --from=po-token-builder \
    /opt/bgutil-ytdlp-pot-provider/LICENSE \
    /opt/bgutil-ytdlp-pot-provider/LICENSE

WORKDIR /app/worker
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && deno --version \
    && node /opt/bgutil-ytdlp-pot-provider/server/build/generate_once.js --version \
        | grep -Fx '1.3.1' \
    && python -c "from importlib.metadata import version; assert version('yt-dlp') == '2026.7.4'; assert version('yt-dlp-ejs') == '0.8.0'; assert version('bgutil-ytdlp-pot-provider') == '1.3.1'"
COPY . .

FROM worker-base AS prepare

ENTRYPOINT ["./entrypoint.sh"]
CMD ["python", "-m", "shorts_worker"]

FROM worker-base AS render

RUN apk add --no-cache font-noto-cjk \
    && python -c "from shorts_worker.editor_renderer import verify_editor_fonts; verify_editor_fonts()"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["python", "-m", "shorts_worker"]
