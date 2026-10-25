from __future__ import annotations

import json
import shutil
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from PIL import Image, ImageChops

from shorts_worker.ranking_pipeline import (
    DESIGN,
    LAYOUT,
    RankingFailure,
    RankingPipeline,
    expand_short_link,
    normalized_link,
    ranking_style,
)


@pytest.fixture
def ranking_project():
    root = Path(__file__).resolve().parents[2] / "storage/ranking-tests"
    project = root / str(uuid4())
    project.mkdir(parents=True)
    (project / "sources.json").write_text("[]")
    try:
        yield project
    finally:
        shutil.rmtree(project)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "https://127.0.0.1/a.mp4",
        "https://youtube.com.evil.test/shorts/abcdefghijk",
        "https://user:password@www.youtube.com/shorts/abcdefghijk",
        "https://www.instagram.com/accounts/login/",
        "https://www.tiktok.com/@user",
        "https://www.youtube.com/playlist?list=abc",
        "https://www.youtube.com:9999/watch?v=abcdefghijk",
    ],
)
def test_ranking_rejects_arbitrary_and_nonvideo_links(url):
    with pytest.raises(RankingFailure):
        normalized_link(url)


def test_ranking_normalizes_platform_links_without_tracking():
    assert normalized_link("https://www.youtube.com/shorts/abcdefghijk?si=secret") == (
        "https://www.youtube.com/watch?v=abcdefghijk",
        "youtube",
    )
    assert normalized_link("https://www.instagram.com/reel/ABCDEFG123/?igsh=secret") == (
        "https://www.instagram.com/reel/ABCDEFG123/",
        "instagram",
    )
    assert normalized_link("https://www.tiktok.com/@test/video/1234567890123456789?_t=secret") == (
        "https://www.tiktok.com/@test/video/1234567890123456789",
        "tiktok",
    )


def test_short_links_follow_only_tiktok_and_drop_tracking(monkeypatch):
    client = httpx.Client
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            302,
            headers={
                "location": "https://www.tiktok.com/@test/video/1234567890123456789?_t=tracking",
            },
        )

    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: client(
            transport=httpx.MockTransport(handler),
            **kwargs,
        ),
    )
    assert expand_short_link("https://vm.tiktok.com/TEST/?share=tracking") == (
        "https://www.tiktok.com/@test/video/1234567890123456789"
    )
    assert len(calls) == 1
    assert "cookie" not in calls[0].headers
    assert not calls[0].url.query


def test_short_links_reject_redirects_to_arbitrary_hosts(monkeypatch):
    client = httpx.Client
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})

    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: client(
            transport=httpx.MockTransport(handler),
            **kwargs,
        ),
    )
    with pytest.raises(RankingFailure):
        expand_short_link("https://vt.tiktok.com/TEST/")
    assert len(calls) == 1


def test_missing_duration_still_uses_bounded_download_before_file_probe(
    ranking_project, monkeypatch
):
    pipeline = RankingPipeline(ranking_project)
    calls = []

    def run(args, timeout=180):
        calls.append(args)
        if "--skip-download" in args:
            return json.dumps({"duration": None, "formats": [{"has_drm": False}]})
        (ranking_project / "download.mp4").write_bytes(b"test")
        return ""

    monkeypatch.setattr(pipeline, "run", run)
    assert pipeline.acquire(ranking_project, "https://www.instagram.com/reel/ABCDE/").exists()
    assert len(calls) == 2
    assert "--max-filesize" in calls[1]
    assert "duration <=? 1200 & !is_live" in calls[1]


@pytest.mark.parametrize(
    "changes",
    [
        {"availability": "needs_auth"},
        {"availability": "subscriber_only"},
        {"is_live": True},
        {"age_limit": 18},
        {"duration": 1201},
        {"formats": [{"has_drm": True}]},
    ],
)
def test_restricted_sources_never_enter_media_download(ranking_project, monkeypatch, changes):
    pipeline = RankingPipeline(ranking_project)
    calls = []

    def metadata(args, timeout=180):
        calls.append(args)
        return json.dumps({"duration": 10, "formats": [{"has_drm": False}], **changes})

    monkeypatch.setattr(pipeline, "run", metadata)
    with pytest.raises(RankingFailure):
        pipeline.acquire(ranking_project, "https://www.youtube.com/shorts/abcdefghijk")
    assert len(calls) == 1
    assert "--skip-download" in calls[0]
    assert not any("cookie" in value for value in calls[0])


@pytest.mark.render
@pytest.mark.parametrize(
    "template,playback_order",
    [(template, None) for template in DESIGN["templates"]] + [("classic", [2, 4, 1, 3])],
)
def test_four_sources_trim_order_audio_and_portrait_render(
    ranking_project, template, playback_order
):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg/ffprobe required")
    pipeline = RankingPipeline(ranking_project)
    sources = []
    colors = ["red", "green", "blue", "yellow"]
    for index, color in enumerate(colors):
        source_id = str(uuid4())
        directory = ranking_project / source_id
        directory.mkdir()
        size = "320x180" if index == 0 else "180x320"
        args = [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s={size}:r=30:d=2",
        ]
        if index != 3:
            args += ["-f", "lavfi", "-i", f"sine=frequency={400 + index * 100}:duration=2"]
        args += [
            "-vf",
            "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(t,0.5)'",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-f",
            "mp4",
            "-y",
            str(directory / "upload"),
        ]
        pipeline.run(args)
        source = pipeline.import_source(source_id)
        assert not (directory / "upload").exists()
        assert source["duration"] == pytest.approx(2, abs=0.05)
        sources.append(source)
    (ranking_project / "sources.json").write_text(json.dumps(sources))
    spec = {
        "title": "테스트 랭킹 TOP 4",
        "style": {
            "template": template,
            **{k: DESIGN["templates"][template][k] for k in ("font", "palette", "position")},
        },
        "descending": True,
        "clips": [
            {
                "rank": i + 1,
                "sourceId": s["id"],
                "label": f"장면 {i + 1}",
                "start": 0.75,
                "end": 1.75,
            }
            for i, s in enumerate(sources)
        ],
    }
    if playback_order is not None:
        spec["playbackOrder"] = playback_order
        for invalid_order in [[], [1, 2], [1, 1, 3, 4], [1, 2, 3, 5], [True, 2, 3, 4]]:
            with pytest.raises(RankingFailure):
                pipeline.validate_render({**spec, "playbackOrder": invalid_order})
    render_id = str(uuid4())
    result = pipeline.render(spec, render_id)
    output = ranking_project / result["fileName"]
    info = pipeline.probe(output)
    assert info["duration"] == pytest.approx(4, abs=0.15)
    assert (info["width"], info["height"], info["hasAudio"]) == (720, 1280, True)
    assert not (ranking_project / f"render-{render_id}").exists()
    # Selected times exclude the white opening. Center pixels prove source order.
    colors_by_rank = {1: (255, 0, 0), 2: (0, 128, 0), 3: (0, 0, 255), 4: (255, 255, 0)}
    expected = [colors_by_rank[rank] for rank in playback_order or [4, 3, 2, 1]]
    for index, target in enumerate(expected):
        frame = ranking_project / f"frame-{index}.png"
        pipeline.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-ss",
                str(index + 0.5),
                "-i",
                str(output),
                "-frames:v",
                "1",
                "-y",
                str(frame),
            ]
        )
        with Image.open(frame) as image:
            pixel = image.convert("RGB").getpixel((360, 640))
        assert all(abs(a - b) < 25 for a, b in zip(pixel, target, strict=True))
    if template == "classic":
        sparse = {
            **spec,
            "rankCount": 10,
            "clips": [{**spec["clips"][1], "rank": 4}, {**spec["clips"][3], "rank": 10}],
        }
        sparse.pop("playbackOrder", None)
        assert [c["rank"] for c in pipeline.validate_render(sparse)] == [10, 4]
        sparse_result = pipeline.render(sparse, str(uuid4()))
        assert pipeline.probe(ranking_project / sparse_result["fileName"])[
            "duration"
        ] == pytest.approx(2, abs=0.15)
        with pytest.raises(RankingFailure):
            pipeline.validate_render({**sparse, "rankCount": 3})
        with pytest.raises(RankingFailure):
            pipeline.validate_render({**sparse, "clips": []})
    bad = {**spec, "clips": [{**spec["clips"][0], "rank": 1, "end": 30}]}
    with pytest.raises(RankingFailure):
        pipeline.validate_render(bad)
    bad = {**spec, "clips": [{**spec["clips"][0], "rank": 1, "sourceId": str(uuid4())}]}
    with pytest.raises(RankingFailure):
        pipeline.validate_render(bad)


def test_ranking_reference_layout_and_progressive_reveal(tmp_path):
    last = tmp_path / "last.png"
    first = tmp_path / "first.png"
    labels = {
        1: "첫 번째 장면",
        2: "두 번째 장면",
        3: "세 번째 장면",
        4: "네 번째 장면",
        5: "마지막 장면",
    }
    RankingPipeline.overlay(
        "역대급 팔씨름", 5, labels[5], 5, last, subtitle="랭킹 갓", labels=labels
    )
    RankingPipeline.overlay(
        "역대급 팔씨름", 1, labels[1], 5, first, subtitle="랭킹 갓", labels=labels
    )
    with Image.open(last) as image, Image.open(first) as revealed:
        assert image.getpixel((0, LAYOUT["headerHeight"] - 1)) == (0, 0, 0, 255)
        assert image.getpixel((0, LAYOUT["headerHeight"]))[3] == 0
        assert image.getpixel((360, 1250))[3] == 0
        colors = set(image.crop((0, 0, 720, LAYOUT["headerHeight"])).getdata())
        assert (255, 224, 0, 255) in colors
        assert (255, 54, 11, 255) in colors
        assert (255, 255, 255, 255) in colors
        assert (
            image.crop(
                (120, LAYOUT["rankBaseline"] - 52, 620, LAYOUT["rankBaseline"] + 5)
            ).getbbox()
            is None
        )
        assert (
            image.crop(
                (120, LAYOUT["rankBaseline"] + 220, 620, LAYOUT["rankBaseline"] + 277)
            ).getbbox()
            is not None
        )
        assert (
            revealed.crop(
                (120, LAYOUT["rankBaseline"] - 52, 620, LAYOUT["rankBaseline"] + 5)
            ).getbbox()
            is not None
        )


def test_custom_order_reveals_only_played_ranks(tmp_path):
    target = tmp_path / "custom-order.png"
    labels = {rank: f"장면 {rank}" for rank in range(1, 6)}
    RankingPipeline.overlay(
        "순서 테스트",
        4,
        labels[4],
        5,
        target,
        labels=labels,
        revealed_ranks=[2, 4],
    )
    with Image.open(target) as image:
        for rank in range(1, 6):
            baseline = LAYOUT["rankBaseline"] + (rank - 1) * LAYOUT["rankStep"]
            bounds = image.crop((120, baseline - 52, 620, baseline + 5)).getbbox()
            assert (bounds is not None) == (rank in (2, 4))


@pytest.mark.parametrize("template", list(DESIGN["templates"]))
def test_templates_clear_top_and_mirror_ranking(tmp_path, template):
    preset = DESIGN["templates"][template]
    style = {"template": template, **{k: preset[k] for k in ("font", "palette", "position")}}
    for position in ("left", "right"):
        target = tmp_path / f"{template}-{position}.png"
        RankingPipeline.overlay(
            "역대급 순간 TOP",
            5,
            "장면",
            5,
            target,
            subtitle="랭킹 갓",
            style={**style, "position": position},
        )
        with Image.open(target) as image:
            header = image.crop((0, 0, 720, LAYOUT["headerHeight"])).convert("RGB")
            text_bounds = ImageChops.difference(header, Image.new("RGB", header.size)).getbbox()
            assert text_bounds[1] >= LAYOUT["topClearance"]
            assert text_bounds[2] <= 680
            first_rank = image.crop(
                (0, LAYOUT["rankBaseline"] - 57, 720, LAYOUT["rankBaseline"] + 8)
            ).getbbox()
            assert first_rank[0] >= LAYOUT["rankLeft"] - 4
            assert first_rank[2] <= LAYOUT["rankRight"] + 4
            if position == "left":
                assert first_rank[2] < 160
            else:
                assert first_rank[0] > 500


@pytest.mark.parametrize(
    "style",
    [
        {"template": "classic", "font": "../../secret", "palette": "gold", "position": "left"},
        {"template": "classic", "font": "jua", "palette": "untrusted", "position": "left"},
        {"template": "classic", "font": {}, "palette": "gold", "position": "left"},
    ],
)
def test_template_rejects_unknown_fonts_and_colors(style):
    with pytest.raises(RankingFailure):
        ranking_style(style)


def test_independent_headline_colors_and_outline(tmp_path):
    target = tmp_path / "custom.png"
    style = {
        "template": "classic",
        "font": "paperlogy",
        "palette": "gold",
        "position": "left",
        "titleColor": "#123abc",
        "subtitleColor": "#ff00aa",
        "accentColor": "#12ff09",
    }
    RankingPipeline.overlay("첫째 줄", 1, "랭킹 이름", 5, target, subtitle="둘째 줄", style=style)
    with Image.open(target) as image:
        colors = set(image.crop((0, 0, 720, LAYOUT["headerHeight"])).getdata())
        assert {(18, 58, 188, 255), (255, 0, 170, 255), (18, 255, 9, 255)} <= colors
        assert LAYOUT["rankOutline"] == 3
    with pytest.raises(RankingFailure):
        ranking_style({**style, "titleColor": "red;evil"})


def test_link_registration_only_reads_metadata_without_media(ranking_project, monkeypatch):
    pipeline = RankingPipeline(ranking_project)
    calls = []

    def metadata(args, timeout=180):
        calls.append(args)
        assert "--skip-download" in args
        assert "--output" not in args
        return json.dumps(
            {"duration": 27.5, "width": 720, "height": 1280, "formats": [{"has_drm": False}]}
        )

    monkeypatch.setattr(pipeline, "run", metadata)
    source_id = str(uuid4())
    result = pipeline.register_link(
        source_id, "https://www.tiktok.com/@test/video/1234567890123456789?tracking=1"
    )
    assert result["duration"] == 27.5
    assert result["remote"] == {
        "url": "https://www.tiktok.com/@test/video/1234567890123456789",
        "platform": "tiktok",
        "videoId": "1234567890123456789",
    }
    assert list(ranking_project.iterdir()) == [ranking_project / "sources.json"]
    assert len(calls) == 1


def test_unknown_link_duration_never_falls_back_to_download(ranking_project, monkeypatch):
    pipeline = RankingPipeline(ranking_project)
    calls = []

    def metadata(args, timeout=180):
        calls.append(args)
        return json.dumps({"formats": [{"has_drm": False}]})

    monkeypatch.setattr(pipeline, "run", metadata)
    source = pipeline.register_link(str(uuid4()), "https://www.instagram.com/reel/ABCDEFG123/")
    assert source["durationKnown"] is False
    assert source["duration"] == 1200
    assert len(calls) == 1
    assert "--skip-download" in calls[0]


def test_pinned_public_attestation_uses_selected_proxy_only(ranking_project, monkeypatch):
    monkeypatch.setenv("RANKING_YOUTUBE_PO_TOKEN_ENABLED", "1")
    validated = []
    monkeypatch.setattr(
        "shorts_worker.ranking_pipeline._validate_po_token_runtime", lambda: validated.append(True)
    )
    pipeline = RankingPipeline(ranking_project)
    calls = []

    def run(args, timeout=180):
        calls.append(args)
        return json.dumps(
            {"duration": 21, "availability": "public", "formats": [{"has_drm": False}]}
        )

    monkeypatch.setattr(pipeline, "run", run)
    pipeline._inspect_link(
        "https://www.youtube.com/shorts/abcdefghijk", "http://selected.test:8080"
    )
    args = calls[0]
    assert validated == [True]
    assert args[args.index("--proxy") + 1] == "http://selected.test:8080"
    assert "youtube:player_client=mweb" in args
    assert "--no-plugin-dirs" not in args
    assert not any("cookie" in x for x in args)
    pipeline._inspect_link("https://www.instagram.com/reel/ABCDE/")
    assert "--no-plugin-dirs" in calls[1]
    assert not any("bgutil" in x for x in calls[1])


def test_attestation_runtime_validation_fails_closed(ranking_project, monkeypatch):
    monkeypatch.setenv("RANKING_YOUTUBE_PO_TOKEN_ENABLED", "1")

    def invalid():
        raise RuntimeError("unverified runtime")

    monkeypatch.setattr("shorts_worker.ranking_pipeline._validate_po_token_runtime", invalid)
    with pytest.raises(RuntimeError):
        RankingPipeline(ranking_project)


def test_fixed_rank_colors_and_inactive_opacity(tmp_path):
    target = tmp_path / "rank-emphasis.png"
    RankingPipeline.overlay(
        "순위 강조",
        2,
        "두 번째",
        3,
        target,
        labels={1: "첫 번째", 2: "두 번째", 3: "세 번째"},
        revealed_ranks=[1, 2, 3],
    )
    with Image.open(target) as image:
        for index, rgb in enumerate([(255, 49, 88), (255, 227, 77), (98, 223, 88)]):
            y = LAYOUT["rankBaseline"] + index * LAYOUT["rankStep"]
            row = image.crop((120, y - 48, 590, y + 6))
            assert row.getchannel("A").getextrema()[1] == (255 if index == 1 else 128)
            assert (*rgb, 255 if index == 1 else 128) in set(row.getdata())


def test_portrait_instagram_formats_and_metadata_reuse(ranking_project, monkeypatch):
    from yt_dlp import YoutubeDL

    pipeline = RankingPipeline(ranking_project)
    calls = []
    metadata = {
        "id": "ABCDE",
        "formats": [
            {
                "format_id": "video",
                "url": "https://example.test/video.mp4",
                "ext": "mp4",
                "width": 720,
                "height": 1280,
                "vcodec": "vp9",
                "acodec": "none",
            },
            {
                "format_id": "audio",
                "url": "https://example.test/audio.m4a",
                "ext": "m4a",
                "vcodec": "none",
                "acodec": "aac",
            },
        ],
    }

    def run(args, timeout=180):
        calls.append(args)
        if "--skip-download" in args:
            return json.dumps(metadata)
        selector = args[args.index("--format") + 1]
        with YoutubeDL({"quiet": True}) as ydl:
            result = list(
                ydl.build_format_selector(selector)(
                    {"formats": metadata["formats"], "incomplete_formats": False}
                )
            )
        assert result and result[0]["format_id"] == "video+audio"
        info_path = Path(args[args.index("--load-info-json") + 1])
        assert json.loads(info_path.read_text()) == metadata
        assert "https://www.instagram.com/reel/ABCDE/" not in args
        (ranking_project / "download.mp4").write_bytes(b"test")
        return ""

    monkeypatch.setattr(pipeline, "run", run)
    pipeline.acquire(ranking_project, "https://www.instagram.com/reel/ABCDE/")
    assert len(calls) == 2
    assert not (ranking_project / "validated-info.json").exists()
