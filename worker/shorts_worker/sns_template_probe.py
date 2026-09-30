"""Bounded synthetic evidence for the exact SNS worker image; no source downloads."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3
from PIL import Image

from .config import Settings
from .font_manifest import canonical_editor_font_manifest
from .media import probe_media, run_command
from .release_identity import _embedded_worker_source_git_sha, _running_container_image_digest
from .sns_template import SIZES, generate_copy, render_sns, sns_layout, validate_copy


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--ai", action="store_true")
    parser.add_argument("--editor", action="store_true")
    parser.add_argument("--community", action="store_true")
    args = parser.parse_args()
    settings = Settings()
    from .community_template import community_layout
    layout_for = community_layout if args.community else sns_layout
    sha = _embedded_worker_source_git_sha()
    image_digest = (
        _running_container_image_digest() if args.upload else os.getenv("WORKER_IMAGE_DIGEST")
    )
    prefix = f"outputs/sns-{'editor' if args.editor else 'template'}-verification/{sha}"
    if args.community:
        prefix = prefix.replace("sns-", "community-")
    fixtures = {
        "ko": (
            "퇴근 1분 전 내 모습",
            "퇴근 시간이 되자 활짝 웃는다.",
            "방금까지 졸렸는데 이제 퇴근 시간이네요. 가방 챙기고 갑니다.",
        ),
        "en": (
            "One minute until home",
            "He smiles when work is over.",
            "I was so sleepy. Now work is over. I am picking up my bag and going home.",
        ),
        "ja": (
            "退勤１分前の自分",
            "退勤時間になると笑顔になる。",
            "さっきまで眠かったのに、もう退勤時間ですね。バッグを持って帰ります。",
        ),
    }
    summary = {
        "sourceGitSha": sha,
        "imageDigest": image_digest,
        "fontManifestSha256": canonical_editor_font_manifest()["sha256"],
        "editor": args.editor,
        "community": args.community,
        "cases": [],
    }
    with tempfile.TemporaryDirectory(prefix="sns-probe-") as directory:
        root = Path(directory)
        cases = [(ratio, language) for ratio in SIZES for language in fixtures]

        def copy(case):
            ratio, language = case
            title, reason, transcript = fixtures[language]
            if args.ai:
                content = generate_copy(
                    settings,
                    title=title,
                    reason=reason,
                    transcript=transcript,
                    ratio="4:5" if args.community else ratio,
                    language=language, community=args.community,
                )
                if args.community:
                    from .community_copy import validate_board_name
                    validate_board_name(content["boardName"], language)
                assert content["source"] == "ai", (ratio, language, "AI fallback")
                validate_copy(
                    {k: content[k] for k in ("title", "body", "hashtags")}, 
                    "4:5" if args.community else ratio, language
                )
            else:
                lines = {"ko": "퇴근이라 신남", "en": "Time to go home", "ja": "退勤で元気になる"}
                tags = {
                    "ko": ["#퇴근", "#공감", "#직장인"],
                    "en": ["#Work", "#Home", "#Mood"],
                    "ja": ["#退勤", "#共感", "#仕事"],
                }
                content = {
                    "title": title,
                    "body": [lines[language]] * layout_for(ratio).body_lines,
                    "hashtags": tags[language] if layout_for(ratio).hashtags else [],
                    **({"boardName": {"ko": "퇴근러 모임", "en": "After Work",
                                      "ja": "退勤のひととき"}[language]} if args.community else {}),
                    "source": "fixture",
                }
            return ratio, language, content

        with ThreadPoolExecutor(max_workers=3) as executor:
            copies = list(executor.map(copy, cases))
        for ratio, language, content in copies:
            case_dir = root / (ratio.replace(":", "x") + "-" + language)
            case_dir.mkdir()
            source, output, frame = (
                case_dir / name for name in ("source.mp4", "output.mp4", "frame.png")
            )
            x, y, width, height = layout_for(ratio).video
            source_width, source_height = (
                (1280, 720) if (ratio, language) == ("9:16", "ko") else (width, height)
            )
            cmd = [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"color=c=blue:s={source_width}x{source_height}:r=10:d=1",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1",
                "-vf",
                "drawbox=x=0:y=0:w=iw:h=30:color=red:t=fill,"
                "drawbox=x=0:y=ih-30:w=iw:h=30:color=lime:t=fill",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                str(source),
            ]
            assert run_command(cmd, timeout=30, cwd=case_dir).returncode == 0
            if args.editor:
                from .editor_renderer import EditorDocumentRenderer
                from .schemas import EditorDocument

                value = json.loads(
                    (Path(__file__).parent / "assets/sns_editor_probe_document.json").read_text()
                )
                content["source"] = "edited"
                value["template"] = {
                    "id": "white-yellow",
                    "customTemplateId": None,
                    "presetVersion": 4,
                    "snapshot": {
                        "presetVersion": 4,
                        "snsTemplateVersion": 1,
                        **({"communityTemplateVersion": 1} if args.community else {}),
                        "snsContent": content,
                        "snsLanguage": language,
                        "brandColor": "#FF715E",
                    },
                }
                value["title"]["text"] = content["title"]
                value["subtitles"] = {"enabled": False, "segments": []}
                value["video"] = {
                    "aspectRatio": ratio,
                    "timelineStartSeconds": 0,
                    "timelineEndSeconds": 1,
                    "selectionStartSeconds": 0,
                    "selectionEndSeconds": 1,
                    "clips": [{"id": "sns", "sourceStartSeconds": 0, "sourceEndSeconds": 1}],
                }
                EditorDocumentRenderer(settings).render(
                    clean_path=source,
                    output_path=output,
                    work_dir=case_dir,
                    document=EditorDocument.model_validate(value),
                    channel_thumbnail_path=None,
                )
            else:
                render_sns(
                    settings,
                    clean_path=source,
                    output_path=output,
                    work_dir=case_dir,
                    ratio=ratio,
                    snapshot={
                        **({"communityTemplateVersion": 1} if args.community else {}),
                        "snsContent": content,
                        "snsLanguage": language,
                        "brandColor": "#FF715E",
                    },
                    channel={"ko": "퇴근연구소", "en": "After Work", "ja": "退勤研究所"}[language],
                    avatar=None,
                )
            if args.community:
                with Image.open(case_dir / "sns-overlay.png") as overlay:
                    assert (255, 255, 255, 255) in set(overlay.crop((200, 150, 880, 255)).getdata())
            probe = probe_media(output, timeout=20)
            video = next(s for s in probe["streams"] if s["codec_type"] == "video")
            assert (video["width"], video["height"]) == (1080, 1920)
            assert any(s["codec_type"] == "audio" for s in probe["streams"])
            assert (
                run_command(
                    [
                        "ffmpeg",
                        "-v",
                        "error",
                        "-y",
                        "-i",
                        str(output),
                        "-frames:v",
                        "1",
                        str(frame),
                    ],
                    timeout=30,
                    cwd=case_dir,
                ).returncode
                == 0
            )
            with Image.open(frame) as picture:
                if args.community:
                    assert picture.getpixel((20, 20))[0] > 230
                    assert 90 < picture.getpixel((20, 20))[1] < 135
                    assert min(picture.getpixel((20, 1900))[:3]) > 240
                else:
                    assert min(picture.getpixel((x, y))[:3]) > 240
                assert picture.getpixel((x + width // 2, y + 10))[0] > 180
                assert picture.getpixel((x + width // 2, y + height - 10))[1] > 180
            case = {
                "ratio": ratio,
                "language": language,
                "videoRect": [x, y, width, height],
                "sourceSize": [source_width, source_height],
                "content": content,
                "frameKey": f"{prefix}/{case_dir.name}.png",
            }
            summary["cases"].append(case)
            if args.upload:
                client = boto3.client("s3", region_name=settings.aws_region)
                client.upload_file(
                    str(frame),
                    settings.s3_bucket,
                    case["frameKey"],
                    ExtraArgs={"ContentType": "image/png"},
                )
        summary["passed"] = True
        report = json.dumps(summary, ensure_ascii=False)
        if args.upload:
            boto3.client("s3", region_name=settings.aws_region).put_object(
                Bucket=settings.s3_bucket,
                Key=f"{prefix}/summary.json",
                Body=report.encode(),
                ContentType="application/json",
            )
        print(report, flush=True)


if __name__ == "__main__":
    main()
