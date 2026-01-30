from __future__ import annotations

import os

def get_openai_model_name() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-4o-mini")

def has_openai_key() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))