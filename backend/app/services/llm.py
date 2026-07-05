from collections.abc import AsyncGenerator

from openai import AsyncOpenAI

from app.services.model_config import LlmConfig


class LlmError(Exception):
    pass


def get_client(config: LlmConfig) -> AsyncOpenAI:
    if not config.base_url:
        raise LlmError("آدرس سرویس مدل زبانی تنظیم نشده است")
    return AsyncOpenAI(base_url=config.base_url, api_key=config.api_key or "not-needed")


async def stream_chat(
    config: LlmConfig,
    messages: list[dict],
    tools: list[dict] | None = None,
) -> AsyncGenerator[dict, None]:
    """Yields dict events: {"type": "token", "content": str} or {"type": "tool_calls", "tool_calls": [...]}"""
    client = get_client(config)
    kwargs = {"model": config.model, "messages": messages, "stream": True}
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"

    stream = await client.chat.completions.create(**kwargs)
    tool_call_chunks: dict[int, dict] = {}
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta and delta.content:
            yield {"type": "token", "content": delta.content}
        if delta and delta.tool_calls:
            for tc in delta.tool_calls:
                slot = tool_call_chunks.setdefault(
                    tc.index, {"id": tc.id, "name": "", "arguments": ""}
                )
                if tc.id:
                    slot["id"] = tc.id
                if tc.function and tc.function.name:
                    slot["name"] += tc.function.name
                if tc.function and tc.function.arguments:
                    slot["arguments"] += tc.function.arguments
    if tool_call_chunks:
        yield {"type": "tool_calls", "tool_calls": list(tool_call_chunks.values())}


async def complete_chat(config: LlmConfig, messages: list[dict]) -> str:
    """Non-streaming helper used for internal tasks like memory summarization."""
    client = get_client(config)
    resp = await client.chat.completions.create(model=config.model, messages=messages, stream=False)
    return resp.choices[0].message.content or ""


async def test_llm_connection(config: LlmConfig) -> tuple[bool, str]:
    try:
        reply = await complete_chat(config, [{"role": "user", "content": "فقط بنویس: OK"}])
        return True, f"اتصال موفق — پاسخ نمونه: {reply[:100]}"
    except Exception as exc:  # noqa: BLE001
        return False, f"خطا در اتصال: {exc}"
