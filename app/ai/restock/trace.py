# app/ai/restock/trace.py
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

@dataclass
class TraceStep:
    name: str
    data: dict[str, Any] = field(default_factory=dict)
    ts: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

@dataclass
class AgentTrace:
    steps: list[TraceStep] = field(default_factory=list)

    def add(self, name: str, **data: Any) -> None:
        self.steps.append(TraceStep(name=name, data=data))