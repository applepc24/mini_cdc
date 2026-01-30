"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { ProductFilters } from "@/components/products/product-filters";
import { ProductTable } from "@/components/products/product-table";
import { ProductFormModal } from "@/components/products/product-form-modal";
import {
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  getAccessToken,
} from "@/lib/api";
import { useDebounce } from "@/hooks/use-debounce";
import { useSettings } from "@/hooks/use-settings";
import { useAppToast } from "@/hooks/use-app-toast";
import { useHotkey } from "@/hooks/use-hotkeys";
import { StockAdjustModal } from "@/components/products/stock-adjust-modal";
import { PUBLIC_OWNER_ID } from "@/lib/publicOwner";
import type { Product } from "@/lib/types";
import { Suspense } from "react";
import Loading from "./loading";
import { CsvImportModal } from "@/components/products/csv-import-modal";
import { mockProducts } from "@/lib/mock/products";

type FilterValues = {
  search: string;
  category: string;
  minQty: string;
  maxQty: string;
  minPrice: string;
  maxPrice: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
};

const defaultFilters: FilterValues = {
  search: "",
  category: "all",
  minQty: "",
  maxQty: "",
  minPrice: "",
  maxPrice: "",
  sortBy: "updated_at",
  sortOrder: "desc",
};

// ✅ unknown 에러에서 메시지 뽑기
function getErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const msg = (e as { message?: unknown }).message;
    return typeof msg === "string" ? msg : String(msg ?? "");
  }
  return String(e ?? "");
}

// ✅ mock 정렬: any 없이 key별 비교
function compareProducts(a: Product, b: Product, sortBy: string, sortOrder: "asc" | "desc") {
  const dir = sortOrder === "asc" ? 1 : -1;

  switch (sortBy) {
    case "updated_at":
      return (
        (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) *
        dir
      );
    case "price":
      return (a.price - b.price) * dir;
    case "qty":
      return (a.qty - b.qty) * dir;
    case "name":
      return a.name.localeCompare(b.name) * dir;
    case "category":
      return a.category.localeCompare(b.category) * dir;
    default:
      // 안전망: 이름 기준
      return a.name.localeCompare(b.name) * dir;
  }
}

export default function ProductsPage() {
  const searchParams = useSearchParams();
  const { settings } = useSettings();
  const { addToast } = useAppToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showStockModal, setShowStockModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);

  const debouncedSearch = useDebounce(filters.search, 300);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) setFilters((prev) => ({ ...prev, search: q }));

    const newProduct = searchParams.get("new");
    if (newProduct === "true") setShowProductModal(true);
  }, [searchParams]);

  // Keyboard shortcut for new product
  useHotkey("n", () => {
    const token = getAccessToken();
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setShowProductModal(true);
  });

  const fetchProducts = useCallback(async () => {
    setLoading(true);

    const token = getAccessToken();

    // ✅ 비로그인: mock 모드
    if (!token) {
      const filtered = mockProducts
        .filter((p) => {
          if (!debouncedSearch) return true;
          const hay = `${p.name} ${p.category}`.toLowerCase();
          return hay.includes(debouncedSearch.toLowerCase());
        })
        .filter((p) =>
          filters.category && filters.category !== "all"
            ? p.category === filters.category
            : true,
        )
        .filter((p) => (filters.minQty ? p.qty >= Number(filters.minQty) : true))
        .filter((p) => (filters.maxQty ? p.qty <= Number(filters.maxQty) : true))
        .filter((p) =>
          filters.minPrice ? p.price >= Number(filters.minPrice) : true,
        )
        .filter((p) =>
          filters.maxPrice ? p.price <= Number(filters.maxPrice) : true,
        );

      const sorted = [...filtered].sort((a, b) =>
        compareProducts(a, b, filters.sortBy, filters.sortOrder),
      );

      const total = sorted.length;
      const start = (currentPage - 1) * settings.itemsPerPage;
      const end = start + settings.itemsPerPage;

      setProducts(sorted.slice(start, end));
      setTotalCount(total);
      setLoading(false);
      return;
    }

    // ✅ 로그인: API 모드
    try {
      const params = new URLSearchParams();

      if (debouncedSearch) params.set("q", debouncedSearch);
      if (filters.category && filters.category !== "all")
        params.set("category", filters.category);

      if (filters.minQty) params.set("minQty", filters.minQty);
      if (filters.maxQty) params.set("maxQty", filters.maxQty);
      if (filters.minPrice) params.set("minPrice", filters.minPrice);
      if (filters.maxPrice) params.set("maxPrice", filters.maxPrice);

      params.set("limit", String(settings.itemsPerPage));
      params.set("offset", String((currentPage - 1) * settings.itemsPerPage));

      params.set("sortBy", filters.sortBy);
      params.set("sortOrder", filters.sortOrder);

      params.set("owner_id", String(PUBLIC_OWNER_ID));

      const res = await apiGet<{ count: number; items: Product[] }>(
        `/products?${params.toString()}`,
      );

      setProducts(res.items);
      setTotalCount(res.count);
    } catch (e: unknown) {
      console.error(e);
      const msg = getErrorMessage(e);

      if (msg.includes("API Error 401")) {
        window.location.href = "/login";
        return;
      }

      addToast("error", "제품 목록 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [
    debouncedSearch,
    filters.category,
    filters.minQty,
    filters.maxQty,
    filters.minPrice,
    filters.maxPrice,
    filters.sortBy,
    filters.sortOrder,
    currentPage,
    settings.itemsPerPage,
    addToast,
  ]);

  const totalPages = Math.ceil(totalCount / settings.itemsPerPage);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleSubmitProduct = async (data: { name: string; category: string; price: number; qty?: number }) => {
    try {
      if (editingProduct) {
        await apiPut<Product>(`/products/${editingProduct.product_id}`, {
          name: data.name,
          category: data.category,
          price: data.price,
        });
        addToast("success", `"${data.name}" 제품이 수정되었습니다`);
      } else {
        await apiPost<Product>(`/products`, {
          name: data.name,
          category: data.category,
          price: data.price,
          qty: data.qty ?? 0,
        });
        addToast("success", `"${data.name}" 제품이 추가되었습니다`);
      }

      setShowProductModal(false);
      setEditingProduct(null);
      setCurrentPage(1);
      await fetchProducts();
    } catch (e: unknown) {
      console.error(e);
      const msg = getErrorMessage(e);

      if (msg === "AUTH_REQUIRED" || msg.includes("API Error 401")) {
        window.location.href = "/login";
        return;
      }

      addToast("error", "저장 실패");
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    try {
      await apiDelete(`/products/${product.product_id}`);
      addToast("success", `"${product.name}" 제품이 삭제되었습니다`);

      setSelectedIds((prev) => prev.filter((id) => id !== product.product_id));
      await fetchProducts();
    } catch (e: unknown) {
      console.error(e);
      const msg = getErrorMessage(e);

      if (msg === "AUTH_REQUIRED" || msg.includes("API Error 401")) {
        window.location.href = "/login";
        return;
      }

      addToast("error", "삭제 실패");
    }
  };

  const handleNewProduct = useCallback(() => {
    const token = getAccessToken();
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setEditingProduct(null);
    setShowProductModal(true);
  }, []);

  return (
    <AppLayout onNewProduct={handleNewProduct}>
      <Suspense fallback={<Loading />}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">제품</h2>
              <p className="text-muted-foreground">
                {products.length} / {totalCount}개 제품
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setShowCsvModal(true)}>CSV 가져오기</Button>

              <Button onClick={handleNewProduct}>
                <Plus className="w-4 h-4 mr-2" />
                제품 추가
              </Button>
            </div>
          </div>

          {/* Filters */}
          <ProductFilters
            filters={filters}
            onChange={(next) => {
              setFilters(next);
              setCurrentPage(1); // ✅ 필터 바뀌면 1페이지로
            }}
            onReset={() => {
              setFilters(defaultFilters);
              setCurrentPage(1);
            }}
          />

          {/* Table */}
          <ProductTable
            products={products}
            loading={loading}
            threshold={settings.threshold}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onEdit={(product) => {
              setEditingProduct(product);
              setShowProductModal(true);
            }}
            onDelete={handleDeleteProduct}
            onStockAdjust={(product) => {
              setSelectedProduct(product);
              setShowStockModal(true);
            }}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {(currentPage - 1) * settings.itemsPerPage + 1} -{" "}
                {Math.min(currentPage * settings.itemsPerPage, totalCount)} /{" "}
                {totalCount}개 제품 표시 중
              </p>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>

                <div className="flex items-center gap-1">
                  {[...Array(Math.min(5, totalPages))].map((_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) pageNum = i + 1;
                    else if (currentPage <= 3) pageNum = i + 1;
                    else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                    else pageNum = currentPage - 2 + i;

                    return (
                      <Button
                        key={pageNum}
                        variant={currentPage === pageNum ? "default" : "ghost"}
                        size="icon"
                        onClick={() => setCurrentPage(pageNum)}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </Suspense>

      {/* Product Form Modal */}
      <ProductFormModal
        isOpen={showProductModal}
        onClose={() => {
          setShowProductModal(false);
          setEditingProduct(null);
        }}
        onSubmit={handleSubmitProduct}
        product={editingProduct}
      />

      {selectedProduct && (
        <StockAdjustModal
          isOpen={showStockModal}
          onClose={() => {
            setShowStockModal(false);
            setSelectedProduct(null);
          }}
          product={selectedProduct}
          onAdjusted={(updated) => {
            setProducts((prev) =>
              prev.map((p) => (p.product_id === updated.product_id ? updated : p)),
            );
            addToast("success", "재고 조정 완료");
            setShowStockModal(false);
            setSelectedProduct(null);
          }}
        />
      )}

      <CsvImportModal
        isOpen={showCsvModal}
        onClose={() => setShowCsvModal(false)}
        onImported={async () => {
          addToast("success", "CSV 업로드 완료");
          setShowCsvModal(false);
          setCurrentPage(1);
          await fetchProducts();
        }}
      />
    </AppLayout>
  );
}