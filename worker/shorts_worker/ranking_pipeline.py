"""Bounded ranking media pipeline. No account cookies or persistent source storage."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlsplit
from uuid import UUID

import httpx
from PIL import Image, ImageDraw, ImageFont

from .errors import InvalidYouTubeUrl
from .url_validation import validate_youtube_url

MAX_BYTES = 250 * 1024 * 1024
MAX_SOURCE_SECONDS = 1200
DEADLINE_SECONDS = 540
ASSETS = Path(__file__).parent / "assets"
DESIGN = json.loads((ASSETS / "ranking_templates.json").read_text())
LAYOUT = DESIGN["layout"]
DEFAULT_STYLE = {"template": "classic", "font": "pretendard", "palette": "gold", "position": "left"}


class RankingFailure(ValueError):
    pass


def ranking_style(value=None) -> dict:
    style = DEFAULT_STYLE if value is None else value
    if (
        not isinstance(style, dict)
        or not set(DEFAULT_STYLE).issubset(style)
        or set(style) - set(DEFAULT_STYLE) - {"titleColor", "subtitleColor", "accentColor"}
        or not all(isinstance(value, str) for value in style.values())
        or style.get("template") not in DESIGN["templates"]
        or style.get("font") not in DESIGN["fonts"]
        or style.get("palette") not in DESIGN["palettes"]
        or style.get("position") not in {"left", "right"}
    ):
        raise RankingFailure("랭킹 템플릿 설정을 확인해 주세요.")
    for key in ("titleColor", "subtitleColor", "accentColor"):
        if key in style and not re.fullmatch(r"#[0-9a-fA-F]{6}", style[key]):
            raise RankingFailure("색상은 올바른 HEX 값으로 선택해 주세요.")
    return style


def checked_id(value: str) -> str:
    if str(UUID(value, version=4)) != value or UUID(value).version != 4:
        raise RankingFailure("잘못된 영상 번호입니다.")
    return value


def normalized_link(value: str) -> tuple[str, str]:
    try:
        parsed = urlsplit(value.strip())
        if (
            parsed.scheme != "https"
            or parsed.username
            or parsed.password
            or parsed.port not in {None, 443}
        ):
            raise ValueError
        host = (parsed.hostname or "").lower()
        if host in {
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "youtu.be",
            "music.youtube.com",
            "www.youtu.be",
        }:
            return validate_youtube_url(value)[0], "youtube"
        if host in {"instagram.com", "www.instagram.com"}:
            match = re.fullmatch(r"/(?:reel|reels|p)/([A-Za-z0-9_-]{5,80})/?", parsed.path)
            if match:
                return f"https://www.instagram.com/reel/{match[1]}/", "instagram"
        if host in {"tiktok.com", "www.tiktok.com", "m.tiktok.com"}:
            match = re.fullmatch(r"/@([A-Za-z0-9_.]{1,40})/video/([0-9]{10,25})/?", parsed.path)
            if match:
                return f"https://www.tiktok.com/@{match[1]}/video/{match[2]}", "tiktok"
    except (ValueError, TypeError, InvalidYouTubeUrl):
        pass
    raise RankingFailure(
        "YouTube 영상·쇼츠, Instagram 릴스, TikTok 영상 링크를 입력해 주세요. "
        "TikTok 단축 링크는 브라우저에서 연 뒤 전체 영상 주소를 복사해 주세요."
    )


def expand_short_link(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.hostname not in {"vm.tiktok.com", "vt.tiktok.com"} and not (
        parsed.hostname in {"www.tiktok.com", "tiktok.com"} and parsed.path.startswith("/t/")
    ):
        return value
    current = f"https://{parsed.hostname}{parsed.path}"
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.port not in {None, 443}
    ):
        raise RankingFailure("올바른 HTTPS 영상 링크를 입력해 주세요.")
    try:
        for _ in range(4):
            target = urlsplit(current)
            if (
                target.scheme != "https"
                or target.username
                or target.password
                or target.port not in {None, 443}
                or target.hostname
                not in {
                    "vm.tiktok.com",
                    "vt.tiktok.com",
                    "www.tiktok.com",
                    "tiktok.com",
                    "m.tiktok.com",
                }
            ):
                raise RankingFailure("지원하지 않는 링크 이동입니다.")
            if re.fullmatch(r"/@[A-Za-z0-9_.]{1,40}/video/[0-9]{10,25}/?", target.path):
                return normalized_link(current)[0]
            # Each hop gets a fresh client: no login material or session cookies.
            with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as client:
                with client.stream("GET", current) as response:
                    if response.status_code not in {301, 302, 303, 307, 308}:
                        break
                    location = response.headers.get("location")
                    if not location:
                        break
                    current = urljoin(current, location)
    except httpx.HTTPError as exc:
        raise RankingFailure("단축 링크를 열지 못했습니다. 전체 영상 주소를 넣어 주세요.") from exc
    raise RankingFailure("단축 링크를 열지 못했습니다. 전체 영상 주소를 넣어 주세요.")


class RankingPipeline:
    def __init__(self, project: Path):
        self.project = project.resolve(strict=True)
        # The caller cannot select arbitrary paths outside local test storage.
        root = Path(
            os.environ.get(
                "RANKING_STORAGE_ROOT",
                str(Path(__file__).resolve().parents[2] / "storage/ranking-tests"),
            )
        )
        if self.project.parent != root.resolve() or not self.project.is_dir():
            raise RankingFailure("잘못된 테스트 작업 경로입니다.")
        checked_id(self.project.name)
        self.deadline = time.monotonic() + DEADLINE_SECONDS

    def run(self, args: list[str], timeout: int = 180) -> str:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise RankingFailure("처리 시간이 초과되었습니다. 더 짧은 영상으로 시도해 주세요.")
        if args[0] == "ffmpeg":
            args = [
                args[0],
                "-threads",
                "2",
                "-filter_threads",
                "2",
                "-filter_complex_threads",
                "2",
                *args[1:],
            ]
        with (
            tempfile.TemporaryFile(dir=self.project) as out,
            tempfile.TemporaryFile(dir=self.project) as err,
        ):
            process = subprocess.Popen(
                args, stdout=out, stderr=err, shell=False, start_new_session=True
            )
            until = time.monotonic() + min(timeout, remaining)
            try:
                while process.poll() is None:
                    if time.monotonic() >= until:
                        raise RankingFailure("영상 처리 시간이 초과되었습니다.")
                    if out.tell() > 4 * 1024 * 1024 or err.tell() > 4 * 1024 * 1024:
                        raise RankingFailure("영상 정보를 처리할 수 없습니다.")
                    # Also bounds unknown-length downloads, for which yt-dlp cannot
                    # enforce --max-filesize before receiving the response body.
                    if any(
                        p.stat().st_size > MAX_BYTES + 4 * 1024 * 1024
                        for p in self.project.rglob("*")
                        if p.is_file()
                    ):
                        raise RankingFailure("250MB 이하의 영상을 사용해 주세요.")
                    time.sleep(0.1)
                if process.returncode:
                    raise RankingFailure(
                        "영상을 가져오거나 변환하지 못했습니다. 공개 영상인지 확인하거나 "
                        "사용 권한이 있는 영상 파일을 직접 넣어 주세요."
                    )
                out.seek(0)
                return out.read(4 * 1024 * 1024).decode("utf8")
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=10)

    def probe(self, source: Path) -> dict:
        data = json.loads(
            self.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-format_whitelist",
                    "mov,matroska,webm,avi",
                    "-show_format",
                    "-show_streams",
                    "-of",
                    "json",
                    str(source),
                ],
                timeout=30,
            )
        )
        videos = [s for s in data.get("streams", []) if s.get("codec_type") == "video"]
        duration = float(data.get("format", {}).get("duration", 0))
        if not videos or not math.isfinite(duration) or not 0.5 <= duration <= MAX_SOURCE_SECONDS:
            raise RankingFailure("원본은 0.5초 이상, 20분 이하의 영상이어야 합니다.")
        video = videos[0]
        width, height = int(video.get("width", 0)), int(video.get("height", 0))
        if not 1 <= width <= 7680 or not 1 <= height <= 7680:
            raise RankingFailure("영상 해상도를 확인해 주세요. 최대 8K까지 지원합니다.")
        return {
            "duration": duration,
            "width": width,
            "height": height,
            "hasAudio": any(s.get("codec_type") == "audio" for s in data["streams"]),
        }

    def inspect_link(self, url: str) -> tuple[str, str, list[str], dict]:
        normalized, platform = normalized_link(expand_short_link(url))
        # Separate metadata gate: never rotate identity/region or use login material.
        base = [
            sys.executable,
            "-m",
            "yt_dlp",
            "--ignore-config",
            "--no-plugin-dirs",
            "--no-playlist",
            "--no-cache-dir",
            "--no-progress",
            "--no-warnings",
            "--socket-timeout",
            "15",
            "--retries",
            "0",
            "--fragment-retries",
            "0",
            "--extractor-retries",
            "0",
            "--proxy",
            "",
            "--playlist-items",
            "1",
            "--use-extractors",
            platform,
        ]
        info = json.loads(self.run([*base, "--dump-single-json", "--skip-download", normalized]))
        duration = info.get("duration")
        if (
            (
                duration is not None
                and (
                    not isinstance(duration, int | float)
                    or not math.isfinite(duration)
                    or not 0.5 <= duration <= MAX_SOURCE_SECONDS
                )
            )
            or info.get("is_live")
            or info.get("live_status") in {"is_live", "is_upcoming"}
            or info.get("availability") not in {None, "public"}
            or info.get("age_limit", 0) not in {None, 0}
            or not info.get("formats")
            or all(f.get("has_drm") for f in info["formats"])
        ):
            raise RankingFailure(
                "로그인·연령·유료·지역 제한이 없는 20분 이하 공개 영상만 사용할 수 있습니다."
            )
        return normalized, platform, base, info

    def register_link(self, source_id: str, url: str) -> dict:
        normalized, platform, _, info = self.inspect_link(url)
        duration = info.get("duration")
        duration_known = (
            isinstance(duration, int | float) and math.isfinite(duration) and duration >= 0.5
        )
        if not duration_known and platform != "instagram":
            raise RankingFailure("영상 길이를 확인하지 못했습니다. 영상 파일을 직접 넣어 주세요.")
        parsed = urlsplit(normalized)
        video_id = (
            parse_qs(parsed.query)["v"][0]
            if platform == "youtube"
            else parsed.path.strip("/").split("/")[-1]
        )
        return {
            "id": checked_id(source_id),
            # Unknown Instagram length is a validation bound, never a displayed duration.
            "duration": duration if duration_known else MAX_SOURCE_SECONDS,
            "durationKnown": duration_known,
            "width": info.get("width") or 0,
            "height": info.get("height") or 0,
            "hasAudio": True,
            "remote": {"url": normalized, "platform": platform, "videoId": video_id},
        }

    def acquire(self, directory: Path, url: str) -> Path:
        normalized, _, base, _ = self.inspect_link(url)
        self.run(
            [
                *base,
                "--max-filesize",
                str(MAX_BYTES),
                "--match-filter",
                "duration <=? 1200 & !is_live",
                "--format",
                "bv*[height<=1080]+ba/b[height<=1080]",
                "--merge-output-format",
                "mp4",
                "--output",
                str(directory / "download.%(ext)s"),
                normalized,
            ]
        )
        candidates = [
            p for p in directory.glob("download.*") if p.suffix in {".mp4", ".webm", ".mkv"}
        ]
        if len(candidates) != 1 or candidates[0].stat().st_size > MAX_BYTES:
            raise RankingFailure("다운로드 가능한 250MB 이하 영상을 사용해 주세요.")
        return candidates[0]

    def import_source(self, source_id: str, url: str | None = None) -> dict:
        directory = self.project / checked_id(source_id)
        if directory.is_symlink() or directory.resolve().parent != self.project:
            raise RankingFailure("잘못된 영상 경로입니다.")
        try:
            source = self.acquire(directory, url) if url else directory / "upload"
            if source.stat().st_size > MAX_BYTES:
                raise RankingFailure("250MB 이하의 영상을 선택해 주세요.")
            probe = self.probe(source)
            args = [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "mov,matroska,webm,avi",
                "-i",
                str(source),
            ]
            if not probe["hasAudio"]:
                args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
            args += [
                "-map",
                "0:v:0",
                "-map",
                "0:a:0" if probe["hasAudio"] else "1:a:0",
                "-t",
                str(probe["duration"]),
                "-vf",
                "scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,"
                "setsar=1,fps=30",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "24",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-ac",
                "2",
                "-ar",
                "48000",
                "-movflags",
                "+faststart",
                "-fs",
                str(MAX_BYTES),
                "-y",
                str(directory / "source.mp4"),
            ]
            self.run(args, timeout=300)
            normalized_probe = self.probe(directory / "source.mp4")
            if abs(normalized_probe["duration"] - probe["duration"]) > 0.2:
                raise RankingFailure(
                    "미리보기 영상이 용량 제한을 초과했습니다. 더 짧은 영상을 사용해 주세요."
                )
            return {"id": source_id, **normalized_probe}
        finally:
            # Full originals and partial downloads stay local and are removed even on failure.
            for file in directory.iterdir():
                if file.name != "source.mp4":
                    if file.is_dir():
                        shutil.rmtree(file)
                    else:
                        file.unlink(missing_ok=True)

    def validate_render(self, spec: dict) -> list[dict]:
        ranking_style(spec.get("style"))
        clips = spec.get("clips", [])
        if not isinstance(clips, list) or not 1 <= len(clips) <= 10:
            raise RankingFailure("순위는 1~10위까지 선택해 주세요.")
        count = spec.get("rankCount", len(clips))
        ranks = [c.get("rank", 0) for c in clips]
        if (
            type(count) is not int
            or not 1 <= count <= 10
            or any(type(rank) is not int or not 1 <= rank <= count for rank in ranks)
            or len(set(ranks)) != len(ranks)
        ):
            raise RankingFailure("선택한 순위 범위 안에서 영상을 넣어 주세요.")
        if not isinstance(spec.get("title"), str) or not 1 <= len(spec["title"].strip()) <= 80:
            raise RankingFailure("제목은 1~80자로 입력해 주세요.")
        if (
            not isinstance(spec.get("subtitle", "랭킹"), str)
            or len(spec.get("subtitle", "랭킹")) > 60
        ):
            raise RankingFailure("둘째 줄 제목은 60자 이내로 입력해 주세요.")
        registered = {s["id"] for s in json.loads((self.project / "sources.json").read_text())}
        total = 0.0
        for clip in clips:
            source_id = checked_id(clip["sourceId"])
            source = self.project / source_id / "source.mp4"
            if source_id not in registered or source.is_symlink():
                raise RankingFailure("등록된 영상을 선택해 주세요.")
            duration = self.probe(source)["duration"]
            start, end = float(clip["start"]), float(clip["end"])
            if (
                not math.isfinite(start)
                or not math.isfinite(end)
                or start < 0
                or end > duration
                or not 0.5 <= end - start <= 60
            ):
                raise RankingFailure("원본 안에서 0.5~60초 구간을 선택해 주세요.")
            if not isinstance(clip.get("label"), str) or len(clip["label"]) > 60:
                raise RankingFailure("순위 이름은 60자 이내로 입력해 주세요.")
            total += end - start
        if total > 180:
            raise RankingFailure("완성 영상은 총 180초 이하여야 합니다.")
        order = spec.get("playbackOrder")
        if order is not None:
            if (
                not isinstance(order, list)
                or any(type(rank) is not int for rank in order)
                or len(order) != len(ranks)
                or set(order) != set(ranks)
            ):
                raise RankingFailure("재생 순서에 각 영상을 한 번씩 포함해 주세요.")
            by_rank = {clip["rank"]: clip for clip in clips}
            return [by_rank[rank] for rank in order]
        return sorted(clips, key=lambda c: c["rank"], reverse=spec.get("descending", True))

    @staticmethod
    def overlay(
        title: str,
        rank: int,
        label: str,
        count: int,
        target: Path,
        subtitle: str = "랭킹",
        labels: dict | None = None,
        descending: bool = True,
        style: dict | None = None,
        revealed_ranks: list[int] | None = None,
    ):
        style = ranking_style(style)
        font_path = ASSETS / "editor_fonts" / DESIGN["fonts"][style["font"]]["file"]
        palette = dict(DESIGN["palettes"][style["palette"]])
        for color, key in (
            ("title", "titleColor"),
            ("subtitle", "subtitleColor"),
            ("accent", "accentColor"),
        ):
            if key in style:
                palette[color] = style[key]
        # The browser preview imports this same manifest.
        image = Image.new("RGBA", (720, 1280), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, 719, LAYOUT["headerHeight"] - 1), fill="#000000")

        def fit(text, maximum, available):
            size = maximum
            while (
                size > 10
                and draw.textlength(text, font=ImageFont.truetype(str(font_path), size)) > available
            ):
                size -= 1
            return ImageFont.truetype(str(font_path), size)

        title_font = fit(title, 72, LAYOUT["titleWidth"])
        draw.text(
            (360, LAYOUT["titleBaseline"]),
            title,
            font=title_font,
            fill=palette["title"],
            anchor="ms",
        )
        prefix = f"{subtitle}  " if subtitle else ""
        top = f"TOP{count}"
        second_font = fit(prefix + top, 72, LAYOUT["titleWidth"])
        x = (720 - draw.textlength(prefix + top, font=second_font)) / 2
        draw.text(
            (x, LAYOUT["subtitleBaseline"]),
            prefix,
            font=second_font,
            fill=palette["subtitle"],
            anchor="ls",
        )
        draw.text(
            (x + draw.textlength(prefix, font=second_font), LAYOUT["subtitleBaseline"]),
            top,
            font=second_font,
            fill=palette["accent"],
            anchor="ls",
        )
        labels = labels or {rank: label}
        colors = ["#f7c64a", "#e3e3e3", "#cd944c"]
        for index in range(count):
            item_rank = index + 1
            y = LAYOUT["rankBaseline"] + index * min(
                LAYOUT["rankStep"],
                (LAYOUT["rankBottom"] - LAYOUT["rankBaseline"]) / max(1, count - 1),
            )
            revealed = (
                item_rank in revealed_ranks
                if revealed_ranks is not None
                else item_rank >= rank
                if descending
                else item_rank <= rank
            )
            text = labels.get(item_rank, "") if revealed else ""
            number = f"{item_rank}."
            number_font = ImageFont.truetype(str(font_path), 48)
            number_width = draw.textlength(number, font=number_font)
            label_font = fit(text, 42, LAYOUT["rankRight"] - LAYOUT["rankLeft"] - number_width - 10)
            x = LAYOUT["rankLeft"]
            if style["position"] == "right":
                x = (
                    LAYOUT["rankRight"]
                    - number_width
                    - (draw.textlength(text, font=label_font) + 10 if text else 0)
                )
            draw.text(
                (x, y),
                number,
                font=number_font,
                fill=colors[index] if index < 3 else "white",
                anchor="ls",
                stroke_width=LAYOUT["rankOutline"],
                stroke_fill="#080808",
            )
            draw.text(
                (x + number_width + 10, y),
                text,
                font=label_font,
                fill="white",
                anchor="ls",
                stroke_width=LAYOUT["rankOutline"],
                stroke_fill="#080808",
            )
        image.save(target)

    def render(self, spec: dict, render_id: str) -> dict:
        checked_id(render_id)
        clips = self.validate_render(spec)
        work = self.project / f"render-{render_id}"
        work.mkdir()
        output = self.project / f"result-{render_id}.mp4"
        try:
            for index, clip in enumerate(clips):
                source = self.project / clip["sourceId"] / "source.mp4"
                overlay = work / f"overlay-{index}.png"
                self.overlay(
                    spec["title"],
                    clip["rank"],
                    clip["label"],
                    spec.get("rankCount", len(clips)),
                    overlay,
                    subtitle=spec.get("subtitle", "랭킹"),
                    labels={c["rank"]: c["label"] for c in clips},
                    descending=spec.get("descending", True),
                    style=spec.get("style"),
                    revealed_ranks=[c["rank"] for c in clips[: index + 1]],
                )
                duration = clip["end"] - clip["start"]
                self.run(
                    [
                        "ffmpeg",
                        "-nostdin",
                        "-v",
                        "error",
                        "-ss",
                        str(clip["start"]),
                        "-i",
                        str(source),
                        "-i",
                        str(overlay),
                        "-filter_complex",
                        f"[0:v]scale=720:{1280 - LAYOUT['headerHeight']}:"
                        "force_original_aspect_ratio=increase:force_divisible_by=2,"
                        f"crop=720:{1280 - LAYOUT['headerHeight']},"
                        f"pad=720:1280:0:{LAYOUT['headerHeight']}:"
                        "color=black,setsar=1,fps=30[base];[base][1:v]overlay=0:0:format=auto[v]",
                        "-map",
                        "[v]",
                        "-map",
                        "0:a:0",
                        "-af",
                        f"apad,atrim=duration={duration}",
                        "-t",
                        str(duration),
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-crf",
                        "22",
                        "-pix_fmt",
                        "yuv420p",
                        "-c:a",
                        "aac",
                        "-ar",
                        "48000",
                        "-ac",
                        "2",
                        "-y",
                        str(work / f"clip-{index}.mp4"),
                    ]
                )
            listing = work / "concat.txt"
            listing.write_text("".join(f"file 'clip-{i}.mp4'\n" for i in range(len(clips))))
            self.run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-f",
                    "concat",
                    "-safe",
                    "1",
                    "-i",
                    str(listing),
                    "-c",
                    "copy",
                    "-movflags",
                    "+faststart",
                    "-y",
                    str(output),
                ]
            )
            probe = self.probe(output)
            expected = sum(c["end"] - c["start"] for c in clips)
            if abs(probe["duration"] - expected) > 0.25:
                raise RankingFailure("완성 영상 길이가 선택 구간과 일치하지 않습니다.")
            return {"duration": probe["duration"], "fileName": output.name}
        except BaseException:
            output.unlink(missing_ok=True)
            raise
        finally:
            shutil.rmtree(work, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["inspect", "import", "render"])
    parser.add_argument("project", type=Path)
    parser.add_argument("id")
    parser.add_argument("--url")
    args = parser.parse_args()
    try:
        pipeline = RankingPipeline(args.project)
        if args.action == "inspect":
            result = pipeline.register_link(args.id, args.url)
        elif args.action == "import":
            result = pipeline.import_source(args.id, args.url)
        else:
            spec = json.loads((pipeline.project / f"spec-{checked_id(args.id)}.json").read_text())
            result = pipeline.render(spec, args.id)
        print(json.dumps(result))
    except RankingFailure as exc:
        print(json.dumps({"error": str(exc)}))
    except (subprocess.TimeoutExpired, OSError, ValueError, KeyError, TypeError):
        print(
            json.dumps({"error": "영상을 처리하지 못했습니다. 파일 형식과 길이를 확인해 주세요."})
        )


if __name__ == "__main__":
    main()
