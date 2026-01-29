"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { MoreHorizontal, Eye, Edit, Trash2, Plus } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TableRowSkeleton } from "@/components/ui/skeleton-loader";
import { getStockStatus } from "@/lib/utils/stock";
import type { Product } from "@/lib/types";

interface ProductTableProps {
  products: Product[];
  loading?: boolean;
  threshold: number;
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onStockAdjust: (product: Product) => void;
}

type MenuPos = { top: number; left: number; width: number };

export function ProductTable({
  products,
  loading,
  threshold,
  selectedIds,
  onSelectionChange,
  onEdit,
  onDelete,
  onStockAdjust,
}: ProductTableProps) {
  const router = useRouter();

  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);

  // ✅ 메뉴 버튼 DOM 저장
  const triggerRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);

  const openProduct = useMemo(
    () => products.find((p) => p.product_id === menuOpenId) ?? null,
    [menuOpenId, products],
  );

  const toggleSelect = (id: number) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((i) => i !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === products.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(products.map((p) => p.product_id));
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ✅ 메뉴 위치 계산 (버튼 기준으로 화면에 fixed로 띄움)
  const computeMenuPos = (id: number) => {
    const el = triggerRefs.current[id];
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const MENU_W = 160; // w-40
    const GAP = 6;

    // 기본: 버튼 아래 오른쪽 정렬
    let left = rect.right - MENU_W;
    let top = rect.bottom + GAP;

    // 화면 밖으로 나가면 보정
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (left < 8) left = 8;
    if (left + MENU_W > vw - 8) left = vw - MENU_W - 8;

    // 아래가 잘리면 위로 띄우기 (대충 높이 170px 가정)
    const approxH = 170;
    if (top + approxH > vh - 8) {
      top = rect.top - approxH - GAP;
      if (top < 8) top = 8;
    }

    setMenuPos({ top, left, width: MENU_W });
  };

  // ✅ 메뉴 열기/닫기
  const toggleMenu = (id: number) => {
    setMenuOpenId((prev) => {
      const next = prev === id ? null : id;
      return next;
    });
  };

  // ✅ 메뉴가 열리면 위치 계산
  useEffect(() => {
    if (menuOpenId == null) {
      setMenuPos(null);
      return;
    }
    computeMenuPos(menuOpenId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpenId]);

  // ✅ 바깥 클릭/ESC 닫기 + 스크롤/리사이즈 시 위치 보정
  useEffect(() => {
    if (menuOpenId == null) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpenId(null);
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;

      const menuEl = menuRef.current;
      const triggerEl = triggerRefs.current[menuOpenId];

      // 메뉴 내부 클릭이면 무시
      if (menuEl && menuEl.contains(target)) return;

      // 트리거 버튼 클릭이면 토글 로직이 처리하니까 무시
      if (triggerEl && triggerEl.contains(target)) return;

      setMenuOpenId(null);
    };

    const onReposition = () => {
      if (menuOpenId != null) computeMenuPos(menuOpenId);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);

    // ⭐ 핵심: 테이블 스크롤/페이지 스크롤에서도 메뉴 위치 유지
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpenId]);

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left w-12"></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                제품
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                카테고리
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                가격
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                재고
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                수정일
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                상태
              </th>
              <th className="px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {[...Array(10)].map((_, i) => (
              <TableRowSkeleton key={i} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border">
        <EmptyState
          title="제품이 없습니다"
          description="필터를 조정하거나 새 제품을 추가해 주세요."
        />
      </div>
    );
  }

  return (
    <>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 w-12">
                  <input
                    type="checkbox"
                    checked={
                      selectedIds.length === products.length && products.length > 0
                    }
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-input text-primary focus:ring-primary"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  제품
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  카테고리
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  가격
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  재고
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                  수정일
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  상태
                </th>
                <th className="px-4 py-3 w-12"></th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              {products.map((product, index) => (
                <motion.tr
                  key={product.product_id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.02 }}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => router.push(`/products/${product.product_id}`)}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(product.product_id)}
                      onChange={() => toggleSelect(product.product_id)}
                      className="w-4 h-4 rounded border-input text-primary focus:ring-primary"
                    />
                  </td>

                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-foreground">{product.name}</p>
                      <p className="text-xs text-muted-foreground">{product.product_id}</p>
                    </div>
                  </td>

                  <td className="px-4 py-3 text-sm text-muted-foreground">{product.category}</td>

                  <td className="px-4 py-3 text-sm text-foreground text-right font-medium">
                    {product.price.toLocaleString("ko-KR")}원
                  </td>

                  <td className="px-4 py-3 text-sm text-foreground text-right font-medium">
                    {product.qty}
                  </td>

                  <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
                    {formatDate(product.updated_at)}
                  </td>

                  <td className="px-4 py-3">
                    <StatusBadge status={getStockStatus(product.qty, threshold)} />
                  </td>

                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      ref={(el) => {
                        triggerRefs.current[product.product_id] = el;
                      }}
                      onClick={() => toggleMenu(product.product_id)}
                      className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                    >
                      <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ✅ 메뉴는 body에 Portal로 렌더링 (테이블/스크롤과 무관) */}
      {menuOpenId != null && menuPos != null && openProduct != null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
            }}
            className="bg-card border border-border rounded-lg shadow-lg z-[9999] py-1"
          >
            <button
              onClick={() => {
                router.push(`/products/${openProduct.product_id}`);
                setMenuOpenId(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            >
              <Eye className="w-4 h-4" />
              상세 보기
            </button>

            <button
              onClick={() => {
                onStockAdjust(openProduct);
                setMenuOpenId(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            >
              <Plus className="w-4 h-4" />
              재고 조정
            </button>

            <button
              onClick={() => {
                onEdit(openProduct);
                setMenuOpenId(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            >
              <Edit className="w-4 h-4" />
              수정
            </button>

            <button
              onClick={() => {
                setDeleteProduct(openProduct);
                setMenuOpenId(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              삭제
            </button>
          </div>,
          document.body,
        )}

      <ConfirmDialog
        isOpen={!!deleteProduct}
        onClose={() => setDeleteProduct(null)}
        onConfirm={() => deleteProduct && onDelete(deleteProduct)}
        title="제품 삭제"
        message={`"${deleteProduct?.name}" 제품을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
        confirmText="삭제"
        variant="danger"
      />
    </>
  );
}