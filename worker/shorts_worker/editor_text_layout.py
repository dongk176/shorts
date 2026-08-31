"""Canonical extra-text wrapping and order, shared by both rendering paths.

The width classes below are the ECMAScript Unicode 16.0 Script=Hangul/Han/
Hiragana/Katakana and Extended_Pictographic union used by
web/lib/editor-render-spec.ts.  Do not substitute Pillow measurements or
Python str.splitlines/str.strip: their newline/whitespace rules differ.
"""

from __future__ import annotations

from bisect import bisect_right
from collections.abc import Iterator, Sequence
from uuid import UUID

_FULL_WIDTH_RANGES = (
    (169, 169), (174, 174), (4352, 4607), (8252, 8252), (8265, 8265), (8482, 8482),
    (8505, 8505), (8596, 8601), (8617, 8618), (8986, 8987), (9000, 9000), (9096, 9096),
    (9167, 9167), (9193, 9203), (9208, 9210), (9410, 9410), (9642, 9643), (9654, 9654),
    (9664, 9664), (9723, 9726), (9728, 9733), (9735, 9746), (9748, 9861), (9872, 9989),
    (9992, 10002), (10004, 10004), (10006, 10006), (10013, 10013), (10017, 10017),
    (10024, 10024), (10035, 10036), (10052, 10052), (10055, 10055), (10060, 10060),
    (10062, 10062), (10067, 10069), (10071, 10071), (10083, 10087), (10133, 10135),
    (10145, 10145), (10160, 10160), (10175, 10175), (10548, 10549), (11013, 11015),
    (11035, 11036), (11088, 11088), (11093, 11093), (11904, 11929), (11931, 12019),
    (12032, 12245), (12293, 12293), (12295, 12295), (12321, 12329), (12334, 12336),
    (12344, 12347), (12349, 12349), (12353, 12438), (12445, 12447), (12449, 12538),
    (12541, 12543), (12593, 12686), (12784, 12830), (12896, 12926), (12951, 12951),
    (12953, 12953), (13008, 13054), (13056, 13143), (13312, 19903), (19968, 40959),
    (43360, 43388), (44032, 55203), (55216, 55238), (55243, 55291), (63744, 64109),
    (64112, 64217), (65382, 65391), (65393, 65437), (65440, 65470), (65474, 65479),
    (65482, 65487), (65490, 65495), (65498, 65500), (94178, 94179), (94192, 94193),
    (110576, 110579), (110581, 110587), (110589, 110590), (110592, 110882),
    (110898, 110898), (110928, 110930), (110933, 110933), (110948, 110951),
    (126976, 127231), (127245, 127247), (127279, 127279), (127340, 127345),
    (127358, 127359), (127374, 127374), (127377, 127386), (127405, 127461),
    (127488, 127503), (127514, 127514), (127535, 127535), (127538, 127546),
    (127548, 127551), (127561, 127994), (128000, 128317), (128326, 128591),
    (128640, 128767), (128884, 128895), (128981, 129023), (129036, 129039),
    (129096, 129103), (129114, 129119), (129160, 129167), (129198, 129279),
    (129292, 129338), (129340, 129349), (129351, 129791), (130048, 131069),
    (131072, 173791), (173824, 177977), (177984, 178205), (178208, 183969),
    (183984, 191456), (191472, 192093), (194560, 195101), (196608, 201546),
    (201552, 205743),
)
_FULL_WIDTH_STARTS = tuple(start for start, _ in _FULL_WIDTH_RANGES)
_JS_WHITESPACE = "\t\n\v\f\r \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff" + "".join(
    chr(point) for point in range(0x2000, 0x200B)
)


def estimated_editor_character_width(character: str, font_size: float) -> float:
    if character in _JS_WHITESPACE:
        return font_size * 0.28
    point = ord(character)
    index = bisect_right(_FULL_WIDTH_STARTS, point) - 1
    if index >= 0 and point <= _FULL_WIDTH_RANGES[index][1]:
        return font_size
    if "A" <= character <= "Z":
        return font_size * 0.68
    if "a" <= character <= "z":
        return font_size * 0.56
    if "0" <= character <= "9":
        return font_size * 0.62
    return font_size * 0.45


def wrap_editor_render_text(value: str, width: float, font_size: float = 72) -> list[str]:
    maximum_width = max(1, width - 44)
    lines: list[str] = []
    for paragraph in (value or "텍스트").split("\n"):
        current = ""
        current_width = 0.0
        for character in paragraph:
            character_width = estimated_editor_character_width(character, font_size)
            if current and current_width + character_width > maximum_width:
                lines.append(current.rstrip(_JS_WHITESPACE))
                current = character.lstrip(_JS_WHITESPACE)
                current_width = (
                    estimated_editor_character_width(current, font_size) if current else 0
                )
            else:
                current += character
                current_width += character_width
        lines.append(current or " ")
    return lines[:20]


def template_text_overlay_id(template_id: str, layer_id: str) -> str:
    # A stable origin prefix lets template changes replace only seeded text,
    # never manually added editor layers. No user strings become file names.
    return f"tpl:{UUID(template_id)}:{UUID(layer_id)}"


def normalize_composition_layer_order(layer_order: Sequence[str]) -> list[str]:
    order = [name for name in layer_order if name != "channel"]
    if "video" in order and "title" in order and order.index("video") > order.index("title"):
        order.remove("video")
        order.insert(order.index("title"), "video")
    return [*order, "channel"]


def composition_steps(layer_order: Sequence[str]) -> Iterator[str | None]:
    """None denotes the shared subtitle plane (browser z-index 50)."""
    for index, name in enumerate(layer_order):
        if index == 4:
            yield None
        yield name
    yield None
