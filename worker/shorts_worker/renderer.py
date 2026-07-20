from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .config import Settings
from .errors import RenderError
from .media import media_duration, probe_media, run_command, video_fps
from .overlays import (
    TEMPLATE_STYLES,
    create_ass_subtitles,
    create_comment_panel,
    create_custom_canvas_overlays,
    create_panel_overlays,
)
from .schemas import (
    CommentOverlay,
    CustomTemplateConfig,
    HighlightClip,
    SubtitleSegment,
    TemplateId,
    TemplateVideoLayer,
    TitleTextStyle,
    VideoAspectRatio,
)

CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920
VIDEO_HEIGHTS = {
    VideoAspectRatio.LANDSCAPE: 608,
    VideoAspectRatio.LANDSCAPE_FIVE_FOUR: 864,
    VideoAspectRatio.SQUARE: 1080,
    VideoAspectRatio.PORTRAIT: 1350,
    VideoAspectRatio.FULL_VERTICAL: 1920,
}


def custom_video_geometry_filters(
    frame: TemplateVideoLayer,
    *,
    fps: float,
) -> tuple[str, str]:
    """Translate saved 1080x1920 template pixels directly into FFmpeg geometry."""
    return (
        (
            f"[0:v]setpts=PTS-STARTPTS,fps={fps:.3f},"
            f"scale={frame.width}:{frame.height}:force_original_aspect_ratio=increase,"
            f"crop={frame.width}:{frame.height}[custom_video]"
        ),
        f"[base][custom_video]overlay=x={frame.x}:y={frame.y}:shortest=1[with_video]",
    )


@dataclass(frozen=True, slots=True)
class VideoLayout:
    video_height: int
    video_y: int
    top_height: int
    top_y: int
    bottom_height: int
    bottom_y: int
    overlay_mode: bool
    subtitle_margin_v: int


def video_layout(video_aspect_ratio: VideoAspectRatio) -> VideoLayout:
    video_height = VIDEO_HEIGHTS[video_aspect_ratio]
    if video_aspect_ratio is VideoAspectRatio.FULL_VERTICAL:
        return VideoLayout(
            video_height=video_height,
            video_y=0,
            top_height=360,
            top_y=96,
            bottom_height=180,
            bottom_y=1620,
            overlay_mode=True,
            subtitle_margin_v=445,
        )
    panel_height = (CANVAS_HEIGHT - video_height) // 2
    video_bottom = panel_height + video_height
    subtitle_inset = max(64, round(video_height * 0.08))
    return VideoLayout(
        video_height=video_height,
        video_y=panel_height,
        top_height=panel_height,
        top_y=0,
        bottom_height=panel_height,
        bottom_y=video_bottom,
        overlay_mode=False,
        subtitle_margin_v=CANVAS_HEIGHT - (video_bottom - subtitle_inset),
    )


def continuous_comment_windows(
    comments: list[CommentOverlay], duration: float
) -> list[tuple[CommentOverlay, float, float]]:
    """Hold each comment until the next starts, covering the complete clip without gaps."""
    if duration <= 0:
        return []
    ordered = sorted(comments, key=lambda item: item.start_seconds)
    windows: list[tuple[CommentOverlay, float, float]] = []
    for index, comment in enumerate(ordered):
        start = 0.0 if index == 0 else min(duration, max(0.0, comment.start_seconds))
        end = (
            duration
            if index == len(ordered) - 1
            else min(duration, max(start, ordered[index + 1].start_seconds))
        )
        if end > start:
            windows.append((comment, start, end))
    return windows


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
        video_aspect_ratio: VideoAspectRatio = VideoAspectRatio.SQUARE,
    ) -> Path:
        work_dir.mkdir(parents=True, exist_ok=True)
        duration = clip.end_seconds - clip.start_seconds
        probe = probe_media(source_path, timeout=min(30, self.settings.ffmpeg_timeout_seconds))
        fps = min(30.0, video_fps(probe))
        has_audio = any(stream.get("codec_type") == "audio" for stream in probe.get("streams", []))
        target_height = VIDEO_HEIGHTS[video_aspect_ratio]
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
            "-vf",
            (
                f"scale={CANVAS_WIDTH}:{target_height}:force_original_aspect_ratio=increase,"
                f"crop={CANVAS_WIDTH}:{target_height},fps={fps:.3f}"
            ),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-r",
            f"{fps:.3f}",
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
        title_font_scale: float = 1.0,
        channel_thumbnail_path: Path | None = None,
        video_aspect_ratio: VideoAspectRatio = VideoAspectRatio.SQUARE,
        comment_overlays: list[CommentOverlay] | None = None,
        title_text_styles: list[TitleTextStyle] | None = None,
        custom_template_config: CustomTemplateConfig | None = None,
    ) -> Path:
        work_dir.mkdir(parents=True, exist_ok=True)
        probe = probe_media(clean_path, timeout=min(30, self.settings.ffmpeg_timeout_seconds))
        duration = media_duration(probe)
        if duration <= 0:
            raise RenderError("clean clip 길이가 올바르지 않습니다.")
        fps = min(30.0, video_fps(probe))
        has_audio = any(stream.get("codec_type") == "audio" for stream in probe.get("streams", []))
        if custom_template_config is not None:
            return self._render_custom_clean_clip(
                clean_path=clean_path,
                output_path=output_path,
                title=title,
                channel_name=channel_name,
                template_id=template_id,
                transcript=transcript,
                subtitles_enabled=subtitles_enabled,
                work_dir=work_dir,
                prefix=prefix,
                channel_thumbnail_path=channel_thumbnail_path,
                comment_overlays=comment_overlays or [],
                config=custom_template_config,
                duration=duration,
                fps=fps,
                has_audio=has_audio,
            )
        layout_ratio = (
            VideoAspectRatio.PORTRAIT
            if template_id is TemplateId.COMMENT_CAPTURE
            and video_aspect_ratio is VideoAspectRatio.FULL_VERTICAL
            else video_aspect_ratio
        )
        layout = video_layout(layout_ratio)
        top, bottom = create_panel_overlays(
            title=title,
            channel_name=channel_name,
            template_id=template_id,
            directory=work_dir / "overlays",
            prefix=prefix,
            title_font_scale=title_font_scale,
            channel_thumbnail_path=channel_thumbnail_path,
            top_height=layout.top_height,
            bottom_height=layout.bottom_height,
            overlay_mode=layout.overlay_mode,
            title_text_styles=title_text_styles,
        )
        visible_comments = (
            sorted(comment_overlays or [], key=lambda item: item.start_seconds)
            if template_id is TemplateId.COMMENT_CAPTURE
            else []
        )
        comment_windows = continuous_comment_windows(visible_comments, duration)
        comment_panels = [
            (
                comment,
                create_comment_panel(
                    comment,
                    work_dir / "overlays" / f"{prefix}_comment_{index}.png",
                    panel_height=layout.bottom_height,
                    overlay_mode=layout.overlay_mode,
                ),
            )
            for index, (comment, _, _) in enumerate(comment_windows)
        ]
        ass_path = None
        if subtitles_enabled:
            ass_path = create_ass_subtitles(
                transcript,
                clip_start=0,
                clip_end=duration,
                output_path=work_dir / "subtitles" / f"{prefix}.ass",
                margin_v=layout.subtitle_margin_v,
            )
        background = TEMPLATE_STYLES[template_id].background.replace("#", "0x")
        filters = [
            f"color=c={background}:s={CANVAS_WIDTH}x{CANVAS_HEIGHT}:r={fps:.3f}:d={duration:.3f}[base]",
            (
                f"[0:v]setpts=PTS-STARTPTS,fps={fps:.3f},"
                f"scale={CANVAS_WIDTH}:{layout.video_height}:force_original_aspect_ratio=decrease,"
                f"pad={CANVAS_WIDTH}:{layout.video_height}:(ow-iw)/2:(oh-ih)/2:color=black[center]"
            ),
            f"[base][center]overlay=x=0:y={layout.video_y}:shortest=1[with_video]",
            f"[with_video][1:v]overlay=x=0:y={layout.top_y}:shortest=1[with_top]",
            f"[with_top][2:v]overlay=x=0:y={layout.bottom_y}:shortest=1[composed]",
        ]
        video_label = "composed"
        for index, ((_comment, _), (_, start, end)) in enumerate(
            zip(comment_panels, comment_windows, strict=False)
        ):
            next_label = f"with_comment_{index}"
            filters.append(
                f"[{video_label}][{index + 3}:v]overlay=x=0:y={layout.bottom_y}:"
                f"enable='gte(t,{start:.3f})*lt(t,{end:.3f})':"
                f"shortest=1[{next_label}]"
            )
            video_label = next_label
        if ass_path:
            filters.append(
                f"[{video_label}]subtitles=filename='{_escape_filter_path(ass_path)}'[captioned]"
            )
            video_label = "captioned"
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-y",
            "-i",
            str(clean_path),
            "-loop",
            "1",
            "-framerate",
            f"{fps:.3f}",
            "-i",
            str(top),
            "-loop",
            "1",
            "-framerate",
            f"{fps:.3f}",
            "-i",
            str(bottom),
        ]
        for _, panel in comment_panels:
            command.extend(["-loop", "1", "-framerate", f"{fps:.3f}", "-i", str(panel)])
        audio_label = None
        if has_audio:
            filters.append("[0:a]asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11[audio]")
            audio_label = "audio"
        command.extend(["-filter_complex", ";".join(filters), "-map", f"[{video_label}]"])
        if audio_label:
            command.extend(["-map", f"[{audio_label}]"])
        command.extend(
            [
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
                f"{fps:.3f}",
            ]
        )
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

    def _render_custom_clean_clip(
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
        channel_thumbnail_path: Path | None,
        comment_overlays: list[CommentOverlay],
        config: CustomTemplateConfig,
        duration: float,
        fps: float,
        has_audio: bool,
    ) -> Path:
        background, title_overlay, channel_overlay = create_custom_canvas_overlays(
            title=title,
            channel_name=channel_name,
            config=config,
            directory=work_dir / "overlays",
            prefix=prefix,
            channel_thumbnail_path=channel_thumbnail_path,
            include_channel=template_id is not TemplateId.COMMENT_CAPTURE,
        )
        visible_comments = (
            sorted(comment_overlays, key=lambda item: item.start_seconds)
            if template_id is TemplateId.COMMENT_CAPTURE
            else []
        )
        comment_windows = continuous_comment_windows(visible_comments, duration)
        comment_panels = [
            create_comment_panel(
                comment,
                work_dir / "overlays" / f"{prefix}_custom_comment_{index}.png",
                panel_height=320,
                overlay_mode=True,
            )
            for index, (comment, _, _) in enumerate(comment_windows)
        ]
        ass_path = None
        if subtitles_enabled:
            ass_path = create_ass_subtitles(
                transcript,
                clip_start=0,
                clip_end=duration,
                output_path=work_dir / "subtitles" / f"{prefix}.ass",
                margin_v=445,
            )
        frame = config.video
        video_geometry_filters = custom_video_geometry_filters(frame, fps=fps)
        filters = [
            f"[1:v]setpts=PTS-STARTPTS,scale={CANVAS_WIDTH}:{CANVAS_HEIGHT}[base]",
            *video_geometry_filters,
            "[with_video][2:v]overlay=x=0:y=0:shortest=1[with_title]",
            "[with_title][3:v]overlay=x=0:y=0:shortest=1[composed]",
        ]
        video_label = "composed"
        comment_y = max(0, min(CANVAS_HEIGHT - 320, config.channel.y - 160))
        for index, (_, start, end) in enumerate(comment_windows):
            next_label = f"with_comment_{index}"
            filters.append(
                f"[{video_label}][{index + 4}:v]overlay=x=0:y={comment_y}:"
                f"enable='gte(t,{start:.3f})*lt(t,{end:.3f})':shortest=1[{next_label}]"
            )
            video_label = next_label
        if ass_path:
            filters.append(
                f"[{video_label}]subtitles=filename='{_escape_filter_path(ass_path)}'[captioned]"
            )
            video_label = "captioned"
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-y",
            "-i",
            str(clean_path),
            "-loop",
            "1",
            "-framerate",
            f"{fps:.3f}",
            "-i",
            str(background),
            "-loop",
            "1",
            "-framerate",
            f"{fps:.3f}",
            "-i",
            str(title_overlay),
            "-loop",
            "1",
            "-framerate",
            f"{fps:.3f}",
            "-i",
            str(channel_overlay),
        ]
        for panel in comment_panels:
            command.extend(["-loop", "1", "-framerate", f"{fps:.3f}", "-i", str(panel)])
        audio_label = None
        if has_audio:
            filters.append("[0:a]asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11[audio]")
            audio_label = "audio"
        command.extend(["-filter_complex", ";".join(filters), "-map", f"[{video_label}]"])
        if audio_label:
            command.extend(["-map", f"[{audio_label}]"])
        command.extend(
            [
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
                f"{fps:.3f}",
            ]
        )
        if audio_label:
            command.extend(["-c:a", "aac", "-b:a", "128k"])
        command.extend(["-movflags", "+faststart", str(output_path)])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        result = run_command(command, timeout=self.settings.ffmpeg_timeout_seconds, cwd=work_dir)
        if result.returncode != 0 or not output_path.is_file() or output_path.stat().st_size == 0:
            raise RenderError("개인 템플릿 렌더링에 실패했습니다.")
        output_probe = probe_media(output_path, timeout=30)
        video = next(
            (
                stream
                for stream in output_probe.get("streams", [])
                if stream.get("codec_type") == "video"
            ),
            {},
        )
        if (
            int(video.get("width", 0)) != CANVAS_WIDTH
            or int(video.get("height", 0)) != CANVAS_HEIGHT
        ):
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
        channel_thumbnail_path: Path | None = None,
        video_aspect_ratio: VideoAspectRatio = VideoAspectRatio.SQUARE,
        title_text_styles: list[TitleTextStyle] | None = None,
    ) -> Path:
        if not source_path.is_file():
            raise RenderError("원본 영상 파일을 찾지 못했습니다.")
        duration = clip.end_seconds - clip.start_seconds
        if duration <= 0:
            raise RenderError("선택된 영상 구간이 올바르지 않습니다.")

        probe = probe_media(source_path, timeout=min(30, self.settings.ffmpeg_timeout_seconds))
        fps = video_fps(probe)
        has_audio = any(stream.get("codec_type") == "audio" for stream in probe.get("streams", []))
        layout = video_layout(video_aspect_ratio)
        top, bottom = create_panel_overlays(
            title=clip.hook_title,
            channel_name=channel_name,
            template_id=template_id,
            directory=work_dir / "overlays",
            prefix=f"clip_{clip_index}",
            title_color=title_color,
            title_font_size=title_font_size,
            channel_thumbnail_path=channel_thumbnail_path,
            top_height=layout.top_height,
            bottom_height=layout.bottom_height,
            overlay_mode=layout.overlay_mode,
            title_text_styles=title_text_styles,
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
                f"scale={CANVAS_WIDTH}:{layout.video_height}:force_original_aspect_ratio=increase,"
                f"crop={CANVAS_WIDTH}:{layout.video_height},fps={fps_text}[center]"
            ),
            f"color=c={background}:s={CANVAS_WIDTH}x{CANVAS_HEIGHT}:r={fps_text}:d={duration:.3f}[base]",
            f"[base][center]overlay=x=0:y={layout.video_y}:shortest=1[with_video]",
            f"[with_video][1:v]overlay=x=0:y={layout.top_y}:shortest=1[with_top]",
            f"[with_top][2:v]overlay=x=0:y={layout.bottom_y}:shortest=1[composed]",
        ]
        video_label = "composed"
        filters.append(
            f"[{audio_input_index}:a]asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11[audio]"
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
