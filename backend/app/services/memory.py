from app.models.thread import Message, Thread
from app.services.llm import LlmConfig, complete_chat
from app.services.tokens import count_tokens

SUMMARY_TRIGGER_TOKENS = 8000
KEEP_RECENT_TOKENS = 4000

SUMMARY_PROMPT = (
    "خلاصه مکالمه قبلی زیر را با پیام‌های جدید ترکیب کن و یک خلاصه فشرده و کامل از تمام نکات و "
    "تصمیم‌های مهم مکالمه (به فارسی) تولید کن که برای ادامه گفتگو در آینده کافی باشد. فقط خود خلاصه را بنویس."
)


async def maybe_summarize_history(
    thread: Thread,
    history: list[Message],
    llm_config: LlmConfig,
) -> list[Message]:
    """Keeps chat threads unbounded in length: once older history exceeds a token budget,
    it gets folded into thread.memory_summary via one LLM call, and only recent messages
    are kept in the per-turn context after that. Returns the (possibly trimmed) history
    to use for this turn; thread.memory_summary is updated in place when triggered."""
    total_tokens = sum(count_tokens(m.content) for m in history)
    if total_tokens <= SUMMARY_TRIGGER_TOKENS:
        return history

    keep_budget = KEEP_RECENT_TOKENS
    keep_from_index = len(history)
    for i in range(len(history) - 1, -1, -1):
        tokens = count_tokens(history[i].content)
        if keep_budget - tokens < 0:
            break
        keep_budget -= tokens
        keep_from_index = i

    to_summarize = history[:keep_from_index]
    to_keep = history[keep_from_index:]
    if not to_summarize:
        return history

    old_summary_block = f"خلاصه قبلی:\n{thread.memory_summary}\n\n" if thread.memory_summary else ""
    conversation_block = "\n".join(f"{m.role.value}: {m.content}" for m in to_summarize)

    try:
        new_summary = await complete_chat(
            llm_config,
            [
                {"role": "system", "content": SUMMARY_PROMPT},
                {"role": "user", "content": f"{old_summary_block}پیام‌های جدید برای افزودن به خلاصه:\n{conversation_block}"},
            ],
        )
        thread.memory_summary = new_summary.strip()
    except Exception:  # noqa: BLE001
        return history  # summarization is best-effort; fall back to unsummarized history

    return to_keep
