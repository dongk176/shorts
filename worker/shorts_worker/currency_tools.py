"""Calculate AI-identified amounts without inspecting or rewriting source text."""

from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from typing import Any

from .currency_localization import (
    RATE_CURRENCIES,
    TARGET_CURRENCIES,
    CurrencySnapshot,
    fetch_snapshot,
)


class CurrencyConverter:
    def __init__(self, job: dict, repository: object) -> None:
        self.language = str(job["output_language"])
        self.target = TARGET_CURRENCIES[self.language]
        self.job = job
        self.repository = repository
        self.snapshot: CurrencySnapshot | None = None
        self.unavailable = False
        self.calls = 0

    def calculate(self, arguments: object) -> dict:
        self.calls += 1
        try:
            if not isinstance(arguments, dict):
                raise ValueError("arguments")
            raw = arguments["amount"]
            if isinstance(raw, bool):
                raise ValueError("amount")
            amount = Decimal(str(raw))
            source = arguments["sourceCurrency"]
            if not amount.is_finite() or abs(amount) > Decimal("9007199254740991"):
                raise ValueError("amount")
            if source not in RATE_CURRENCIES:
                raise ValueError("currency")
        except (KeyError, ValueError, TypeError, InvalidOperation):
            return {"status": "invalid_amount", "action": "retain_original_amount_and_currency"}
        if source == self.target:
            return self._result(amount)
        if self.unavailable:
            return {"status": "unavailable", "action": "retain_original_amount_and_currency"}
        try:
            if self.snapshot is None:
                saved = (self.job.get("performance_metrics") or {}).get("currencyLocalization")
                rate = (
                    CurrencySnapshot.from_dict(saved, self.target)
                    if saved else fetch_snapshot(self.target)
                )
                if not saved:
                    rate = CurrencySnapshot.from_dict(
                        self.repository.pin_currency_snapshot(str(self.job["id"]), rate.to_dict()),
                        self.target,
                    )
                self.snapshot = rate
            converted = self.snapshot.convert(amount, source)
            return self._result(converted)
        except Exception:
            # An optional rate provider/storage failure must not discard a video.
            self.unavailable = True
            return {"status": "unavailable", "action": "retain_original_amount_and_currency"}


    def _result(self, amount: Decimal) -> dict:
        number = format(amount, ",.2f" if self.target == "USD" else ",.0f")
        display = {"KRW": number + "원", "JPY": number + "円", "USD": "$" + number}[self.target]
        return {"status": "ok", "amount": str(amount), "currency": self.target, "display": display}


def complete_chat(client: Any, *, currency_converter: CurrencyConverter | None = None, **request):
    """Identify money with AI, calculate it, then finish the original generation."""
    if currency_converter is None:
        return client.chat.completions.create(**request)
    original_messages = request.pop("messages")
    language = {"ko": "Korean", "en": "English", "ja": "Japanese"}[currency_converter.language]
    instructions = [message["content"] for message in original_messages
                    if message["role"] == "system"]
    instructions.append(
        f"Write the requested content in {language}. "
        f"Express actual monetary amounts in {currency_converter.target}. "
        "Identify clear monetary amounts using the full context and submit them together "
        "to convert_currency. Use an empty amounts list when none are clear. "
        "Use each returned display value as the monetary text in titles, reasons and comments. "
        "Keep ordinary words, identifiers, names and uncertain amounts faithful to the source. "
        "When conversion is unavailable, retain the original amount and currency. "
        "After using the tool, return the originally requested JSON format."
    )
    # Some OpenAI-compatible providers replace repeated system messages.
    messages = [{"role": "system", "content": "\n\n".join(instructions)},
                *[message for message in original_messages if message["role"] != "system"]]
    tools = [{"type": "function", "function": {
        "name": "convert_currency", "description": "Calculate identified monetary amounts.",
        "parameters": {"type": "object", "properties": {
            "amounts": {"type": "array", "items": {
                "type": "object", "properties": {
                    "amount": {"type": "string", "description": "Decimal amount in full units."},
                    "sourceCurrency": {"type": "string", "enum": sorted(RATE_CURRENCIES)},
                }, "required": ["amount", "sourceCurrency"], "additionalProperties": False,
            }},
        }, "required": ["amounts"], "additionalProperties": False},
    }}]
    # One identification turn prevents the model from skipping arithmetic. Its
    # empty list is valid; the server never searches the transcript for money.
    identify_request = {key: value for key, value in request.items() if key != "response_format"}
    identified = client.chat.completions.create(
        **identify_request, messages=messages, tools=tools,
        tool_choice={"type": "function", "function": {"name": "convert_currency"}},
    )
    if identified.choices and identified.choices[0].message.tool_calls:
        message = identified.choices[0].message
        messages.append(message.model_dump(exclude_none=True))
        remaining = 32
        for call in message.tool_calls:
            result: dict = {
                "status": "unavailable", "action": "retain_original_amount_and_currency",
            }
            try:
                args = json.loads(call.function.arguments)
                amounts = args.get("amounts") if isinstance(args, dict) else None
                if call.function.name == "convert_currency" and isinstance(amounts, list):
                    converted = []
                    for amount in amounts[:remaining]:
                        converted.append({"source": amount, **currency_converter.calculate(amount)})
                    remaining -= len(converted)
                    result = {"conversions": converted,
                              "remainingAction": "retain_original_amount_and_currency"}
            except (TypeError, ValueError):
                pass
            messages.append({
                "role": "tool", "tool_call_id": call.id, "content": json.dumps(result),
            })
    else:
        messages.append({"role": "user", "content": (
            "Currency conversion is unavailable. Retain original amounts and currencies "
            "and finish the requested content."
        )})
    response = client.chat.completions.create(
        **request, messages=messages, tools=tools, tool_choice="none",
    )
    if response.usage and identified.usage:
        response.usage.prompt_tokens += identified.usage.prompt_tokens
        response.usage.completion_tokens += identified.usage.completion_tokens
        response.usage.total_tokens += identified.usage.total_tokens
    return response
