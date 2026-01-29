"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { ProductFilters } from "@/components/products/product-filters";
import { ProductTable } from "@/components/products/product-table";
import { ProductFormModal } from "@/components/products/product-form-modal";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { useDebounce } from "@/hooks/use-debounce";
import { useSettings } from "@/hooks/use-settings";
import { useAppToast } from "@/hooks/use-app-toast";
import { useHotkey } from "@/hooks/use-hotkeys";
import { StockAdjustModal } from "@/components/products/stock-adjust-modal";
import { PUBLIC_OWNER_ID } from "@/lib/publicOwner";
import type { Product, ProductInput } from "@/lib/types";
import { Suspense } from "react";
import Loading from "./loading";
import { CsvImportModal } from "@/components/products/csv-import-modal";

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
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("accessToken")
        : null;

    if (!token) {
      window.location.href = "/login";
      return;
    }

    setShowProductModal(true);
  });

  // Filter and sort products
  const fetchProducts = useCallback(async () => {
    setLoading(true);

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

      // ✅ 읽기 요청은 prefix 없이 /products 로 보냄 (api.ts가 토큰 유무로 /public 또는 /search로 라우팅)
      const res = await apiGet<{ count: number; items: Product[] }>(
        `/products?${params.toString()}`,
      );

      setProducts(res.items);
      setTotalCount(res.count);
    } catch (e: any) {
      console.error(e);

      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("accessToken")
          : null;

      if (token && String(e?.message ?? "").includes("API Error 401")) {
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

  // Pagination
  const totalPages = Math.ceil(totalCount / settings.itemsPerPage);

  // Reset to page 1 when filters change
  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleSubmitProduct = async (data: any) => {
    console.log(
      "SUBMIT PATH",
      editingProduct ? `/products/${editingProduct.product_id}` : "/products",
    );

    try {
      if (editingProduct) {
        // ✅ 수정은 writer (PUT /products/{id})
        await apiPut<Product>(`/products/${editingProduct.product_id}`, {
          name: data.name,
          category: data.category,
          price: data.price,
        });
        addToast("success", `"${data.name}" 제품이 수정되었습니다`);
      } else {
        // ✅ 신규 생성은 writer (POST /products)
        await apiPost<Product>(`/products`, {
          name: data.name,
          category: data.category,
          price: data.price,
          qty: data.qty,
        });
        addToast("success", `"${data.name}" 제품이 추가되었습니다`);
      }

      setShowProductModal(false);
      setEditingProduct(null);

      // ✅ 저장 후 재조회 (읽기)
      setCurrentPage(1);
      await fetchProducts();
    } catch (e: any) {
      console.error(e);

      // ✅ 토큰 없어서 api.ts에서 막힌 케이스
      if (String(e?.message ?? "") === "AUTH_REQUIRED") {
        window.location.href = "/login";
        return;
      }

      // ✅ 토큰 만료 등 401도 로그인으로
      if (String(e?.message ?? "").includes("API Error 401")) {
        window.location.href = "/login";
        return;
      }

      addToast("error", "저장 실패");
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    try {
      // ✅ 삭제는 writer (DELETE /products/{id})
      await apiDelete(`/products/${product.product_id}`);
      addToast("success", `"${product.name}" 제품이 삭제되었습니다`);

      setSelectedIds((prev) => prev.filter((id) => id !== product.product_id));

      await fetchProducts();
    } catch (e: any) {
      console.error(e);

      if (String(e?.message ?? "") === "AUTH_REQUIRED") {
        window.location.href = "/login";
        return;
      }
      if (String(e?.message ?? "").includes("API Error 401")) {
        window.location.href = "/login";
        return;
      }

      addToast("error", "삭제 실패");
    }
  };

  const handleNewProduct = useCallback(() => {
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("accessToken")
        : null;

    if (!token) {
      window.location.href = "/login";
      return;
    }

    setEditingProduct(null);
    setShowProductModal(true);
  }, []);

  // const handleStockAdjust = async (
  //   type: "in" | "out",
  //   quantity: number,
  //   note: string,
  // ) => {
  //   if (!selectedProduct) return;

  //   try {
  //     const updated = await apiPost<Product>(
  //       `/search/products/${selectedProduct.product_id}/stock-adjust`,
  //       { type, quantity, note },
  //     );

  //     // ✅ 테이블에서 해당 row만 qty 즉시 반영
  //     setProducts((prev) =>
  //       prev.map((p) => (p.product_id === updated.product_id ? updated : p)),
  //     );

  //     addToast("success", "재고 조정 완료");
  //   } catch (e) {
  //     console.error(e);
  //     addToast("error", "재고 조정 실패");
  //   } finally {
  //     setShowStockModal(false);
  //     setSelectedProduct(null);
  //   }
  // };

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
              <Button onClick={() => setShowCsvModal(true)}>
                CSV 가져오기
              </Button>

              <Button onClick={handleNewProduct}>
                <Plus className="w-4 h-4 mr-2" />
                제품 추가
              </Button>
            </div>
          </div>

          {/* Filters */}
          <ProductFilters
            filters={filters}
            onChange={setFilters}
            onReset={() => setFilters(defaultFilters)}
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
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
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
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
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
            // ✅ 테이블 row 즉시 반영
            setProducts((prev) =>
              prev.map((p) =>
                p.product_id === updated.product_id ? updated : p,
              ),
            );

            // ✅ 성공 토스트
            addToast("success", "재고 조정 완료");

            // 모달 닫기 + 선택 초기화
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
