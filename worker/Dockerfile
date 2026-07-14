FROM denoland/deno:bin-2.8.3 AS deno

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deno /deno /usr/local/bin/deno

# Download wireproxy
RUN curl -L -o /tmp/wireproxy.tar.gz https://github.com/pufferffish/wireproxy/releases/download/v1.0.8/wireproxy_linux_amd64.tar.gz \
    && tar -xzf /tmp/wireproxy.tar.gz -C /usr/local/bin/ \
    && rm /tmp/wireproxy.tar.gz \
    && chmod +x /usr/local/bin/wireproxy

WORKDIR /app/worker
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && deno --version \
    && python -c "from importlib.metadata import version; assert version('yt-dlp') == '2026.7.4'; assert version('yt-dlp-ejs') == '0.8.0'"
COPY . .

ENTRYPOINT ["./entrypoint.sh"]
CMD ["python", "-m", "shorts_worker"]
