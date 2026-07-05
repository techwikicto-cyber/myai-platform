def count_tokens(text: str) -> int:
    """Rough offline token estimate (~4 chars/token), avoiding any network-dependent tokenizer
    so the platform keeps working with fully on-prem/local model deployments."""
    return max(1, len(text or "") // 4)
