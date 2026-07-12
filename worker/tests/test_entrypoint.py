from pathlib import Path


def test_wireproxy_is_not_daemonized_twice() -> None:
    script = (Path(__file__).parents[1] / "entrypoint.sh").read_text(encoding="utf-8")

    assert 'wireproxy -d' not in script
    assert 'touch /dev/log' in script
    assert 'wireproxy -c "$WARP_CONFIG_PATH" &' in script
