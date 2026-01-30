"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ChevronRight,
  Package,
  Edit,
  Trash2,
  Plus,
  Clock,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";

import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { TabsCustom } from "@/components/ui/tabs-custom";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CardSkeleton } from "@/components/ui/skeleton-loader";

import { ProductFormModal } from "@/components/products/product-form-modal";
import { StockAdjustModal } from "@/components/products/stock-adjust-modal";

import { apiGet, apiPut, apiDelete, getAccessToken } from "@/lib/api";
import { getStockStatus } from "@/lib/utils/stock";

import { useSettings } from "@/hooks/use-settings";
import { useAppToast } from "@/hooks/use-app-toast";

import type { Product, StockHistory, ProductInput } from "@/lib/types";
import { mockProducts } from "@/lib/mock/products";
import { PUBLIC_OWNER_ID } from "@/lib/publicOwner";

export default function ProductDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { settings } = useSettings();
  const { addToast } = useAppToast();

  const [product, setProduct] = useState<Product | null>(null);
  const [history, setHistory] = useState<StockHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [memo, setMemo] = useState("");

  const [showEditModal, setShowEditModal] = useState(false);
  const [showStockModal, setShowStockModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);


  function getParamString(
    params: ReturnType<typeof useParams>,
    key: string,
  ): string {
    const v = params[key];
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v[0] ?? "";
    return "";
  }
  // ✅ params.id는 "PRD-0001" 같은 문자열일 수도 있고, "123" 같은 숫자 문자열일 수도 있음
  const rawId = getParamString(params, "id");

  const token = getAccessToken();
  const isMockMode = !token;

  useEffect(() => {
    const fetchProduct = async () => {
      setLoading(true);

      try {
        // ✅ mock 모드: mockProducts에서 찾기
        if (isMockMode) {
          const found = mockProducts.find(
            (p) => String(p.product_id) === rawId,
          );
          setProduct(found ?? null);
          setHistory([]); // 목 이력은 일단 빈 배열(원하면 생성 가능)
          return;
        }

        // ✅ 로그인 모드: 서버에서 읽기
        // - 서버 id 타입이 number면 rawId가 숫자일 때만 호출
        // - 너 API가 /products/{product_id} 를 int로 받는 구조면 아래처럼 Number 변환 필요
        const productIdNum = Number(rawId);
        if (Number.isNaN(productIdNum)) {
          setProduct(null);
          return;
        }

        const ownerId = PUBLIC_OWNER_ID;
        const item = await apiGet<Product>(
          `/products/${productIdNum}?owner_id=${ownerId}`,
        );
        setProduct(item);
        setHistory([]); // 재고 이력 API 없으면 비워두기
      } catch (e) {
        console.error(e);
        setProduct(null);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [rawId, isMockMode]);

  const tabs = [
    { id: "overview", label: "개요" },
    { id: "history", label: "재고 이력" },
    { id: "notes", label: "메모" },
  ];

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // const handleStockAdjusted = (
  //   updated: Product,
  //   type: "in" | "out",
  //   quantity: number,
  //   note: string,
  // ) => {
  //   setProduct(updated);

  //   addToast(
  //     "success",
  //     `재고 ${type === "in" ? "입고" : "출고"}: ${quantity}개`,
  //   );

  //   const now = new Date().toISOString();
  //   const newHistory: StockHistory = {
  //     id: `HST-${updated.product_id}-${Date.now()}`,
  //     product_id: String(updated.product_id),
  //     type,
  //     quantity,
  //     note: note || (type === "in" ? "Stock added" : "Stock removed"),
  //     created_at: now,
  //   };

  //   setHistory((prev) => [newHistory, ...prev]);
  // };

  const requireAuthOrGoLogin = () => {
    if (!token) {
      addToast("info", "로그인이 필요합니다");
      window.location.href = "/login";
      return false;
    }
    return true;
  };

  const handleSubmitEdit = async (data: ProductInput) => {
    if (!product) return;
    if (!requireAuthOrGoLogin()) return;

    try {
      const productIdNum = Number(rawId);
      const updated = await apiPut<Product>(`/products/${productIdNum}`, {
        name: data.name,
        category: data.category,
        price: data.price,
      });

      setProduct(updated);
      addToast("success", `"${updated.name}" 제품이 수정되었습니다`);
      setShowEditModal(false);
    } catch (e: unknown) {
      console.error(e);

      const msg = e instanceof Error ? e.message : String(e);

      if (msg === "AUTH_REQUIRED") {
        window.location.href = "/login";
        return;
      }
      if (msg.includes("API Error 401")) {
        window.location.href = "/login";
        return;
      }

      addToast("error", "제품 수정 실패");
    }
  };

  const handleDelete = async () => {
    if (!requireAuthOrGoLogin()) return;

    try {
      const productIdNum = Number(rawId);
      await apiDelete<{ ok: boolean }>(`/products/${productIdNum}`);

      addToast("success", `"${product?.name}" 제품이 삭제되었습니다`);
      router.push("/products");
    } catch (e: unknown) {
      console.error(e);

      const msg = e instanceof Error ? e.message : String(e);

      if (msg === "AUTH_REQUIRED") {
        window.location.href = "/login";
        return;
      }
      if (msg.includes("API Error 401")) {
        window.location.href = "/login";
        return;
      }

      addToast("error", "제품 삭제 실패");
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <div className="h-8 w-48 bg-muted rounded animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <CardSkeleton />
            <div className="lg:col-span-2">
              <CardSkeleton />
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!product) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20">
          <Package className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">
            제품을 찾을 수 없습니다
          </h2>
          <p className="text-muted-foreground mb-6">
            요청하신 제품이 존재하지 않습니다.
          </p>
          <Link href="/products">
            <Button>제품 목록으로</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        {/* (선택) mock 모드 배너 */}
        {isMockMode && (
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            현재 <b>체험 모드</b>입니다. (로그인하면 수정/삭제/재고조정이
            가능해요)
          </div>
        )}

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href="/products"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            제품
          </Link>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <span className="text-foreground font-medium">{product.name}</span>
        </nav>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              {product.name}
            </h1>
            <p className="text-muted-foreground">
              {String(product.product_id)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                isMockMode ? requireAuthOrGoLogin() : setShowStockModal(true)
              }
              disabled={isMockMode}
              title={isMockMode ? "로그인 후 사용 가능" : undefined}
            >
              <Plus className="w-4 h-4 mr-2" />
              재고 조정
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                isMockMode ? requireAuthOrGoLogin() : setShowEditModal(true)
              }
              disabled={isMockMode}
              title={isMockMode ? "로그인 후 사용 가능" : undefined}
            >
              <Edit className="w-4 h-4 mr-2" />
              수정
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                isMockMode ? requireAuthOrGoLogin() : setShowDeleteDialog(true)
              }
              disabled={isMockMode}
              title={isMockMode ? "로그인 후 사용 가능" : undefined}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              삭제
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Product Image Placeholder */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card rounded-xl border border-border overflow-hidden"
          >
            <div className="aspect-square bg-muted flex items-center justify-center">
              <Package className="w-20 h-20 text-muted-foreground" />
            </div>
          </motion.div>

          {/* Product Info */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="lg:col-span-2 bg-card rounded-xl border border-border p-6"
          >
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="text-sm text-muted-foreground mb-1">카테고리</p>
                <p className="font-medium text-foreground">
                  {product.category}
                </p>
              </div>
              <StatusBadge
                status={getStockStatus(product.qty, settings.threshold)}
                size="lg"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <div>
                <p className="text-sm text-muted-foreground mb-1">가격</p>
                <p className="text-2xl font-semibold text-foreground">
                  {Number(product.price).toLocaleString("ko-KR")}원
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">재고</p>
                <p className="text-2xl font-semibold text-foreground">
                  {product.qty}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">임계값</p>
                <p className="text-2xl font-semibold text-foreground">
                  {settings.threshold}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">최근 수정</p>
                <p className="text-sm font-medium text-foreground">
                  {formatDate(product.updated_at)}
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Tabs Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card rounded-xl border border-border overflow-hidden"
        >
          <div className="p-4 border-b border-border">
            <TabsCustom
              tabs={tabs}
              activeTab={activeTab}
              onChange={setActiveTab}
            />
          </div>

          <div className="p-6">
            {activeTab === "overview" && (
              <div className="space-y-4">
                <h3 className="font-semibold text-foreground">제품 개요</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">
                      총 가치
                    </p>
                    <p className="text-xl font-semibold text-foreground">
                      {(
                        Number(product.price) * Number(product.qty)
                      ).toLocaleString("ko-KR")}
                      원
                    </p>
                  </div>
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">
                      재고 상태
                    </p>
                    <p className="text-xl font-semibold text-foreground">
                      {product.qty === 0
                        ? "품절"
                        : product.qty < 5
                          ? "위험"
                          : product.qty < settings.threshold
                            ? "부족"
                            : "정상"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "history" && (
              <div className="space-y-4">
                <h3 className="font-semibold text-foreground">재고 이력</h3>
                {history.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    재고 이력이 없습니다
                  </p>
                ) : (
                  <div className="space-y-3">
                    {history.map((item, index) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="flex items-start gap-4 p-4 bg-muted/30 rounded-lg"
                      >
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            item.type === "in"
                              ? "bg-emerald-500/10"
                              : "bg-red-500/10"
                          }`}
                        >
                          {item.type === "in" ? (
                            <ArrowDownToLine className="w-5 h-5 text-emerald-500" />
                          ) : (
                            <ArrowUpFromLine className="w-5 h-5 text-red-500" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-foreground">
                              {item.type === "in" ? "+" : "-"}
                              {item.quantity}개
                            </p>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDate(item.created_at)}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {item.note}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "notes" && (
              <div className="space-y-4">
                <h3 className="font-semibold text-foreground">제품 메모</h3>
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="이 제품에 대한 메모를 작성하세요..."
                  className="w-full h-40 p-4 bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
                <div className="flex justify-end">
                  <Button
                    onClick={() => addToast("success", "메모가 저장되었습니다")}
                  >
                    메모 저장
                  </Button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>

      {/* ✅ Modals (mock 모드에서는 아예 열리지 않도록 위에서 버튼 disabled 처리) */}
      <ProductFormModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSubmit={handleSubmitEdit}
        product={product}
      />

      <StockAdjustModal
        isOpen={showStockModal}
        onClose={() => setShowStockModal(false)}
        product={product}
        onAdjusted={(updated) => {
          setProduct(updated);
          addToast("success", "재고 조정 완료");

          // (선택) history에 추가하고 싶으면 StockAdjustModal이 note/type/qty를 알려줘야 가능
          // 지금 타입상 불가능하니 일단 제거.
        }}
      />

      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        title="제품 삭제"
        message={`"${product.name}" 제품을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
        confirmText="삭제"
        variant="danger"
      />
    </AppLayout>
  );
}
