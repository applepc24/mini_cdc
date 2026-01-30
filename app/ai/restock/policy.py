from __future__ import annotations
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class RestockPolicy:
    window_days: int = 30
    cover_days: int = 5
    fallback_days: int = 3

    def compute_target(
        self,
        threshold: int,
        product_out_qty: int,
        category_avg_daily: float | None,
    ) -> tuple[int, float, str]:
        """
        return: (target_qty, avg_daily_used, reason)
        """
        if product_out_qty > 0:
            avg_daily = product_out_qty / float(self.window_days)
            target = math.ceil(avg_daily * self.cover_days)
            reason = "product_sales"
        else:
            if category_avg_daily is not None and category_avg_daily > 0:
                avg_daily = float(category_avg_daily)
                target = math.ceil(avg_daily * self.fallback_days)
                reason = "category_sales"
            else:
                avg_daily = 0.0
                target = threshold
                reason = "threshold_fallback"

        target = max(target, threshold)
        return int(target), float(avg_daily), reason

    def compute_recommend_in(self, current_qty: int, target_qty: int) -> int:
        return max(0, int(target_qty) - int(current_qty))