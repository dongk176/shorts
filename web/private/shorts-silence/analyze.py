"""Bounded audio-only analysis of an owned, signed clipped video. No account keys."""
import json
import math
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

def parse_silences(log, start, end):
    ranges = []
    left = None
    for kind, value in re.findall(r'silence_(start|end):\s*([0-9.]+)', log):
        value = min(end - start, max(0., float(value)))
        if kind == 'start':
            left = value
        elif left is not None:
            ranges.append([round(start + left, 6), round(start + value, 6)])
            left = None
    if left is not None:
        ranges.append([round(start + left, 6), end])
    return ranges


def analyze(config):
    url = urlsplit(config['url'])
    if (url.scheme != 'https' or url.hostname != config['host'] or url.username or url.password
            or not url.path.startswith('/edit-sources/')):
        raise ValueError('Invalid owned source')
    start, end = float(config['start']), float(config['end'])
    if not all(map(math.isfinite, [start, end])) or start < 0 or not 1 <= end - start <= 180:
        raise ValueError('Invalid analysis range')
    # Protocol and seek inputs are server-authored. Never invoke a shell.
    try:
        run = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-rw_timeout', '20000000',
            '-ss', str(start), '-t', str(end - start), '-i', config['url'], '-vn',
            '-af', 'silencedetect=noise=-30dB:d=0.30', '-f', 'null', '-'],
            text=True, capture_output=True, timeout=90, shell=False)
    except (subprocess.TimeoutExpired, OSError):
        # TimeoutExpired includes its full command, including the signed media
        # URL. Keep that temporary access token out of sandbox tracebacks.
        raise RuntimeError('Owned audio analysis did not complete') from None
    if run.returncode:
        raise RuntimeError('Owned audio could not be analyzed')
    return {'version': 1, 'preset': 'aggressive', 'silences': parse_silences(run.stderr, start, end)}


if __name__ == '__main__':
    config = json.loads(Path('/vercel/sandbox/silence-input.json').read_text())
    print(json.dumps(analyze(config)))
