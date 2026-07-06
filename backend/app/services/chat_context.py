from app.models.thread import Message, MessageRole
from app.models.workspace import Workspace
from app.services.tokens import count_tokens

MAX_HISTORY_TOKENS = 6000

DEFAULT_SYSTEM_PROMPT = (
    "تو یک دستیار هوشمند هستی که به کاربر بر اساس اسناد و اطلاعات این فضای کاری کمک می‌کنی. "
    "پاسخ‌ها را با فرمت Markdown بنویس. اگر اطلاعات کافی نداری، صادقانه بگو."
)


def build_messages(
    workspace: Workspace,
    history: list[Message],
    memory_summary: str | None,
    extra_context: str | None,
    new_user_message: str,
) -> list[dict]:
    system_prompt = workspace.system_prompt or DEFAULT_SYSTEM_PROMPT
    if extra_context:
        system_prompt = f"{system_prompt}\n\nمنابع مرتبط:\n{extra_context}"
    if memory_summary:
        system_prompt = f"{system_prompt}\n\nخلاصه مکالمات قبلی:\n{memory_summary}"

    messages: list[dict] = [{"role": "system", "content": system_prompt}]

    budget = MAX_HISTORY_TOKENS
    recent: list[dict] = []
    for m in reversed(history):
        tokens = count_tokens(m.content)
        if budget - tokens < 0:
            break
        budget -= tokens
        recent.append({"role": m.role.value, "content": m.content})
    recent.reverse()

    messages.extend(recent)
    messages.append({"role": MessageRole.user.value, "content": new_user_message})
    return messages
