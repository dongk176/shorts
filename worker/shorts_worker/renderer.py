from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from .config import Settings
from .errors import RenderError
from .media import media_duration, probe_media, run_command, video_fps
from .overlays import TEMPLATE_STYLES, create_ass_subtitles, create_panel_overlays
from .schemas import HighlightClip, SubtitleSegment, TemplateId


def _escape_filter_path(path: Path) -> str:
    return (
        str(path.resolve())
        .replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("[", "\\[")
        .replace("]", "\\]")
        .replace(",", "\\,")
    )


class VideoRenderer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def extract_clean_clip(
        self,
        *,
        source_path: Path,
        output_path: Path,
        clip: HighlightClip,
        work_dir: Path,
    ) -> Path:
        work_dir.mkdir(parents=True, exist_ok=True)
        duration = clip.end_seconds - clip.start_seconds
        probe = probe_media(source_path, timeout=min(30, self.settings.ffmpeg_timeout_seconds))
        fps = min(30.0, video_fps(probe))
        has_audio = any(stream.get("codec_type") == "audio" for stream in probe.get("streams", []))
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
            "-ss", f"{clip.start_seconds:.3f}", "-t", f"{duration:.3f}",
            "-i", str(source_path),
            "-vf", (
                "scale=1080:1080:force_original_aspect_ratio=increase,"
                f"crop=1080:1080,fps={fps:.3f}"
            ),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-r", f"{fps:.3f}",
        ]
        if has_audio:
            command.extend(["-c:a", "aac", "-b:a", "128k"])
        else:
            command.append("-an")
        command.extend(["-movflags", "+faststart", str(output_path)])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        result = run_command(command, timeout=self.settings.ffmpeg_timeout_seconds, cwd=work_dir)
        if result.returncode != 0 or not output_path.is_file():
            raise RenderError("편집용 clean clip을 만들지 못했습니다.")
        return output_path

    def render_clean_clip(
        self,
        *,
        clean_path: Path,
        output_path: Path,
        title: str,
        channel_name: str,
        template_id: TemplateId,
        transcript: list[SubtitleSegment],
        subtitles_enabled: bool,
        work_dir: Path,
        prefix: str,
    ) -> Path:
        work_dir.mkdir(parents=True, exist_ok=True)
        probe = probe_media(clean_path, timeout=min(30, self.settings.ffmpeg_timeout_seconds))
        duration = media_duration(probe)
        if duration <= 0:
            raise RenderError("clean clip 길이가 올바르지 않습니다.")
        fps = min(30.0, video_fps(probe))
        has_audio = any(stream.get("codec_type") == "audio" for stream in probe.get("streams", []))
        top, bottom = create_panel_overlays(
            title=title,
            channel_name=channel_name,
            template_id=template_id,
            directory=work_dir / "overlays",
            prefix=prefix,
        )
        ass_path = None
        if subtitles_enabled:
            ass_path = create_ass_subtitles(
                transcript,
                clip_start=0,
                clip_end=duration,
                output_path=work_dir / "subtitles" / f"{prefix}.ass",
            )
        background = TEMPLATE_STYLES[template_id].background.replace("#", "0x")
        filters = [
            f"color=c={background}:s=1080x1920:r={fps:.3f}:d={duration:.3f}[base]",
            "[base][0:v]overlay=x=0:y=420:shortest=1[with_video]",
            "[with_video][1:v]overlay=x=0:y=0:shortest=1[with_top]",
            "[with_top][2:v]overlay=x=0:y=1500:shortest=1[composed]",
        ]
        video_label = "composed"
        if ass_path:
            filters.append(
                f"[composed]subtitles=filename='{_escape_filter_path(ass_path)}'[captioned]"
            )
            video_label = "captioned"
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
            "-i", str(clean_path),
            "-loop", "1", "-framerate", f"{fps:.3f}", "-i", str(top),
            "-loop", "1", "-framerate", f"{fps:.3f}", "-i", str(bottom),
        ]
        audio_label = None
        if has_audio:
            filters.append("[0:a]asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11[audio]")
            audio_label = "audio"
        command.extend(["-filter_complex", ";".join(filters), "-map", f"[{video_label}]"])
        if audio_label:
            command.extend(["-map", f"[{audio_label}]"])
        command.extend([
            "-t", f"{duration:.3f}", "-c:v", "libx264", "-preset", "veryfast",
            "-crf", "23", "-pix_fmt", "yuv420p", "-r", f"{fps:.3f}",
        ])
        if audio_label:
            command.extend(["-c:a", "aac", "-b:a", "128k"])
        command.extend(["-movflags", "+faststart", str(output_path)])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        result = run_command(command, timeout=self.settings.ffmpeg_timeout_seconds, cwd=work_dir)
        if result.returncode != 0 or not output_path.is_file() or output_path.stat().st_size == 0:
            raise RenderError("clean clip 렌더링에 실패했습니다.")
        output_probe = probe_media(output_path, timeout=30)
        video = next(
            (s for s in output_probe.get("streams", []) if s.get("codec_type") == "video"),
            {},
        )
        if int(video.get("width", 0)) != 1080 or int(video.get("height", 0)) != 1920:
            output_path.unlink(missing_ok=True)
            raise RenderError("완성 영상 해상도를 검증하지 못했습니다.")
        return output_path

    def render(
        self,
        *,
        source_path: Path,
        output_path: Path,
        clip: HighlightClip,
        clip_index: int,
        channel_name: str,
        template_id: TemplateId,
        transcript: list[SubtitleSegment],
        work_dir: Path,
        log: Callable[[str], None] | None = None,
        title_color: str | None = None,
        title_font_size: int | None = None,
    ) -> Path:
        if not source_path.is_file():
            raise RenderError("원본 영상 파일을 찾지 못했습니다.")
        duration = clip.end_seconds - clip.start_seconds
        if duration <= 0:
            raise RenderError("선택된 영상 구간이 올바르지 않습니다.")

        probe = probe_media(source_path, timeout=min(30, self.settings.ffmpeg_timeout_seconds))
        fps = video_fps(probe)
        has_audio = any(
            stream.get("codec_type") == "audio" for stream in probe.get("streams", [])
        )
        top, bottom = create_panel_overlays(
            title=clip.hook_title,
            channel_name=channel_name,
            template_id=template_id,
            directory=work_dir / "overlays",
            prefix=f"clip_{clip_index}",
            title_color=title_color,
            title_font_size=title_font_size,
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.unlink(missing_ok=True)

        fps_text = f"{fps:.3f}"
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-y",
            "-ss",
            f"{clip.start_seconds:.3f}",
            "-t",
            f"{duration:.3f}",
            "-i",
            str(source_path),
            "-loop",
            "1",
            "-framerate",
            fps_text,
            "-i",
            str(top),
            "-loop",
            "1",
            "-framerate",
            fps_text,
            "-i",
            str(bottom),
        ]
        audio_input_index = 0
        if not has_audio:
            audio_input_index = 3
            command.extend(
                [
                    "-f",
                    "lavfi",
                    "-t",
                    f"{duration:.3f}",
                    "-i",
                    "anullsrc=channel_layout=stereo:sample_rate=48000",
                ]
            )

        background = TEMPLATE_STYLES[template_id].background.replace("#", "0x")
        filters = [
            (
                f"[0:v]setpts=PTS-STARTPTS,"
                "scale=1080:1080:force_original_aspect_ratio=increase,"
                f"crop=1080:1080,fps={fps_text}[center]"
            ),
            f"color=c={background}:s=1080x1920:r={fps_text}:d={duration:.3f}[base]",
            "[base][center]overlay=x=0:y=420:shortest=1[with_video]",
            "[with_video][1:v]overlay=x=0:y=0:shortest=1[with_top]",
            "[with_top][2:v]overlay=x=0:y=1500:shortest=1[composed]",
        ]
        video_label = "composed"
        filters.append(
            f"[{audio_input_index}:a]asetpts=PTS-STARTPTS,"
            "loudnorm=I=-16:TP=-1.5:LRA=11[audio]"
        )
        command.extend(
            [
                "-filter_complex",
                ";".join(filters),
                "-map",
                f"[{video_label}]",
                "-map",
                "[audio]",
                "-t",
                f"{duration:.3f}",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-r",
                fps_text,
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
                str(output_path),
            ]
        )
        result = run_command(
            command,
            timeout=self.settings.ffmpeg_timeout_seconds,
            cwd=work_dir,
        )
        combined_log = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
        if log and combined_log:
            log(combined_log[-20_000:])
        if result.returncode != 0 or not output_path.is_file() or output_path.stat().st_size == 0:
            output_path.unlink(missing_ok=True)
            detail = result.stderr.strip().splitlines()
            suffix = detail[-1][:300] if detail else "알 수 없는 FFmpeg 오류"
            raise RenderError(f"쇼츠 렌더링에 실패했습니다. ({suffix})")

        output_probe = probe_media(output_path, timeout=30)
        output_duration = media_duration(output_probe)
        if output_duration <= 0:
            output_path.unlink(missing_ok=True)
            raise RenderError("완성된 영상 파일을 검증하지 못했습니다.")
        return output_path
