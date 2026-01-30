# app/services/restock_service.py
from __future__ import annotations

"""
Legacy compatibility layer.

기존 import 경로(app.services.restock_service)를 유지하면서,
실제 구현은 app.ai.restock.service로 위임한다.
"""

from app.ai.restock.service import (
    get_restock_recommendations,
    apply_restock_recommendations,
)

__all__ = ["get_restock_recommendations", "apply_restock_recommendations"]