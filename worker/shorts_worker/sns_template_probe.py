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
    args = parser.parse_args()
    settings = Settings()
    sha = _embedded_worker_source_git_sha()
    image_digest = (
        _running_container_image_digest() if args.upload else os.getenv("WORKER_IMAGE_DIGEST")
    )
    prefix = f"outputs/sns-template-verification/{sha}"
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
                    ratio=ratio,
                    language=language,
                )
                assert content["source"] == "ai", (ratio, language, "AI fallback")
                validate_copy(
                    {k: content[k] for k in ("title", "body", "hashtags")}, ratio, language
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
                    "body": [lines[language]] * sns_layout(ratio).body_lines,
                    "hashtags": tags[language] if sns_layout(ratio).hashtags else [],
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
            x, y, width, height = sns_layout(ratio).video
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
                f"color=c=blue:s={source_width}x{source_height}:r=10:d=0.5",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=0.5",
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
            render_sns(
                settings,
                clean_path=source,
                output_path=output,
                work_dir=case_dir,
                ratio=ratio,
                snapshot={"snsContent": content, "snsLanguage": language, "brandColor": "#FF715E"},
                channel={"ko": "퇴근연구소", "en": "After Work", "ja": "退勤研究所"}[language],
                avatar=None,
            )
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
