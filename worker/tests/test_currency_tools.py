import json
from unittest.mock import MagicMock

from openai.types.chat import ChatCompletion

from shorts_worker.currency_tools import complete_chat


def response(*, text=None, calls=None):
    return ChatCompletion.model_validate({
        "id": "test", "created": 0, "model": "test", "object": "chat.completion",
        "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
        "choices": [{"index": 0, "finish_reason": "tool_calls" if calls else "stop",
                     "message": {"role": "assistant", "content": text, "tool_calls": calls}}],
    })


def tool(arguments='{"amounts":[{"amount":"1700000","sourceCurrency":"KRW"}]}'):
    return {"id": "conversion", "type": "function", "function": {
        "name": "convert_currency", "arguments": arguments,
    }}


def test_plain_generation_keeps_original_protocol():
    client = MagicMock()
    request = {"model": "legacy", "messages": [{"role": "user", "content": "이유로"}]}
    complete_chat(client, **request)
    client.chat.completions.create.assert_called_once_with(**request)


def test_calculated_amount_reaches_model_without_rewriting_original_request():
    client, converter = MagicMock(), MagicMock(target="JPY", language="ja")
    converter.calculate.return_value = {"status": "ok", "amount": "170000", "currency": "JPY"}
    client.chat.completions.create.side_effect = [
        response(calls=[tool()]), response(text='{"title":"17万円"}'),
    ]
    messages = [{"role": "system", "content": "元の選定基準。日本語のタイトルを返す。"},
                {"role": "user", "content": "이유로 27N1을 골랐어요. 가격은 170만 원입니다."}]
    result = complete_chat(client, currency_converter=converter, model="test", messages=messages)
    converter.calculate.assert_called_once_with({"amount": "1700000", "sourceCurrency": "KRW"})
    request = client.chat.completions.create.call_args.kwargs
    assert request["messages"][1] == messages[1]
    systems = [m["content"] for m in request["messages"] if m["role"] == "system"]
    assert len(systems) == 1
    assert messages[0]["content"] in systems[0]
    assert "Japanese" in systems[0]
    assert len(messages) == 2
    assert json.loads(request["messages"][-1]["content"])["conversions"][0]["amount"] == "170000"
    assert result.choices[0].message.content == '{"title":"17万円"}'
    assert result.usage.total_tokens == 24


def test_malformed_tool_call_allows_final_generation():
    client, converter = MagicMock(), MagicMock(target="JPY", language="ja")
    client.chat.completions.create.side_effect = [
        response(calls=[tool("not JSON")]), response(text='{"title":"元の金額"}'),
    ]
    result = complete_chat(client, currency_converter=converter, model="test", messages=[])
    converter.calculate.assert_not_called()
    assert result.choices[0].message.content == '{"title":"元の金額"}'


def test_empty_amount_list_finishes_without_currency_lookup():
    client, converter = MagicMock(), MagicMock(target="JPY", language="ja")
    client.chat.completions.create.side_effect = [
        response(calls=[tool('{"amounts":[]}')]), response(text='{"title":"理由と27N1"}'),
    ]
    result = complete_chat(client, currency_converter=converter, model="test", messages=[])
    converter.calculate.assert_not_called()
    assert result.choices[0].message.content == '{"title":"理由と27N1"}'
    assert client.chat.completions.create.call_count == 2
    assert client.chat.completions.create.call_args.kwargs["tool_choice"] == "none"


def test_excessive_tool_amounts_are_bounded_without_rejecting_the_final_text():
    client, converter = MagicMock(), MagicMock(target="JPY", language="ja")
    converter.calculate.return_value = {"status": "unavailable"}
    client.chat.completions.create.side_effect = [
        response(calls=[tool(json.dumps({"amounts": [
            {"amount": "10", "sourceCurrency": "KRW"} for _ in range(40)
        ]}))]), response(text='{"title":"Original amount"}'),
    ]
    complete_chat(client, currency_converter=converter, model="test", messages=[])
    assert client.chat.completions.create.call_count == 2
    assert converter.calculate.call_count == 32
