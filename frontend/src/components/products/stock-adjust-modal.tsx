"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsCustom } from "@/components/ui/tabs-custom";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import type { Product } from "@/lib/types";
import { apiPost } from "@/lib/api";

interface StockAdjustModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;

  onAdjust?: (type: "in" | "out", quantity: number, note: string) => void;
  onAdjusted?: (updated: Product) => void;
}

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// product_id / id 둘 다 대응 (any 없이)
function getProductId(product: Product): string | number {
  const maybe = product as unknown as { product_id?: string | number; id?: string | number };
  const id = maybe.product_id ?? maybe.id;

  if (id == null) {
    throw new Error("product_id 또는 id가 없습니다. Product 타입/데이터 확인 필요");
  }
  return id;
}

export function StockAdjustModal({
  isOpen,
  onClose,
  product,
  onAdjust,
  onAdjusted,
}: StockAdjustModalProps) {
  const [type, setType] = useState<"in" | "out">("in");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const productId = getProductId(product);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const qty = Number(quantity);

    if (!qty || qty <= 0) {
      setError("유효한 수량을 입력해 주세요");
      return;
    }

    if (type === "out" && qty > product.qty) {
      setError(`현재 재고(${product.qty}개)보다 많이 출고할 수 없습니다`);
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");

      const updated = await apiPost<Product>(`/products/${productId}/stock-adjust`, {
        type,
        quantity: qty,
        note: note.trim() ? note.trim() : null,
      });

      // (옵션) 기존 콜백 유지
      onAdjust?.(type, qty, note.trim());

      // (추천) 최신 product로 부모 화면 갱신
      onAdjusted?.(updated);

      // 초기화 + 닫기
      setQuantity("");
      setNote("");
      onClose();
    } catch (err: unknown) {
      console.error(err);

      const msg = getErrorMessage(err);

      if (msg === "AUTH_REQUIRED" || msg.includes("API Error 401")) {
        window.location.href = "/login";
        return;
      }

      setError(msg || "재고 조정에 실패했습니다. 서버 상태를 확인해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const tabs = [
    { id: "in", label: "입고", icon: <ArrowDownToLine className="w-4 h-4" /> },
    { id: "out", label: "출고", icon: <ArrowUpFromLine className="w-4 h-4" /> },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="재고 조정" size="sm">
      <div className="space-y-4">
        <div className="text-center pb-4 border-b border-border">
          <p className="text-sm text-muted-foreground">현재 재고</p>
          <p className="text-3xl font-semibold text-foreground">{product.qty}</p>
        </div>

        <TabsCustom
          tabs={tabs}
          activeTab={type}
          onChange={(id) => {
            setType(id === "out" ? "out" : "in");
            setError("");
          }}
        />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="quantity">{type === "in" ? "입고 수량" : "출고 수량"}</Label>
            <Input
              id="quantity"
              type="number"
              min="1"
              max={type === "out" ? product.qty : undefined}
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setError("");
              }}
              placeholder="수량 입력"
              className={error ? "border-red-500" : ""}
              disabled={isSubmitting}
            />
            {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
          </div>

          <div>
            <Label htmlFor="note">메모 (선택)</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 창고에서 입고"
              disabled={isSubmitting}
            />
          </div>

          <div className="pt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">변경 후 재고:</span>
            <span className="font-semibold text-foreground">
              {type === "in"
                ? product.qty + (Number(quantity) || 0)
                : Math.max(0, product.qty - (Number(quantity) || 0))}
            </span>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 bg-transparent"
              onClick={onClose}
              disabled={isSubmitting}
            >
              취소
            </Button>
            <Button
              type="submit"
              className="flex-1"
              variant={type === "out" ? "destructive" : "default"}
              disabled={isSubmitting}
            >
              {isSubmitting ? "처리중..." : type === "in" ? "입고" : "출고"}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}