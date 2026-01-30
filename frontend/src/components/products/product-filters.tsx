"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, getAccessToken } from "@/lib/api";
import { mockProducts } from "@/lib/mock/products";

interface FilterValues {
  search: string;
  category: string;
  minQty: string;
  maxQty: string;
  minPrice: string;
  maxPrice: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

interface ProductFiltersProps {
  filters: FilterValues;
  onChange: (filters: FilterValues) => void;
  onReset: () => void;
}

const sortOptions = [
  { value: "name", label: "이름" },
  { value: "category", label: "카테고리" },
  { value: "price", label: "가격" },
  { value: "qty", label: "재고" },
  { value: "updated_at", label: "최근 수정" },
];

function getMockCategories() {
  return Array.from(new Set(mockProducts.map((p) => p.category))).sort((a, b) =>
    a.localeCompare(b),
  );
}

export function ProductFilters({ filters, onChange, onReset }: ProductFiltersProps) {
  const [expanded, setExpanded] = useState(true);
  const [categories, setCategories] = useState<string[]>([]);
  const [catLoading, setCatLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setCatLoading(true);

        const token = getAccessToken();

        // ✅ 로그인 안 했으면 mock 카테고리
        if (!token) {
          if (!mounted) return;
          setCategories(getMockCategories());
          return;
        }

        // ✅ 로그인 했으면 서버 카테고리
        const res = await apiGet<{ items: string[] }>("/search/categories");
        if (!mounted) return;

        const items = (res.items ?? []).filter(Boolean);
        setCategories(items.length ? items : getMockCategories()); // ✅ 서버가 비어도 mock fallback
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setCategories(getMockCategories()); // ✅ 실패하면 mock fallback (빈 배열 X)
      } finally {
        if (!mounted) return;
        setCatLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const updateFilter = (key: keyof FilterValues, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="font-medium text-foreground">필터</span>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-5 h-5 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="p-4 border-t border-border space-y-4">
              {/* Search */}
              <div>
                <Label className="text-sm text-muted-foreground mb-1.5 block">
                  검색
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="제품 검색..."
                    value={filters.search}
                    onChange={(e) => updateFilter("search", e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {/* Category & Sort */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-muted-foreground mb-1.5 block">
                    카테고리
                  </Label>
                  <select
                    value={filters.category}
                    onChange={(e) => updateFilter("category", e.target.value)}
                    className="w-full h-10 px-3 bg-background border border-input rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                  >
                    <option value="all">전체 카테고리</option>

                    {catLoading && (
                      <option value="" disabled>
                        불러오는 중...
                      </option>
                    )}

                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label className="text-sm text-muted-foreground mb-1.5 block">
                    정렬
                  </Label>
                  <div className="flex gap-2">
                    <select
                      value={filters.sortBy}
                      onChange={(e) => updateFilter("sortBy", e.target.value)}
                      className="flex-1 h-10 px-3 bg-background border border-input rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                    >
                      {sortOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        updateFilter(
                          "sortOrder",
                          filters.sortOrder === "asc" ? "desc" : "asc",
                        )
                      }
                      className="shrink-0"
                    >
                      {filters.sortOrder === "asc" ? "↑" : "↓"}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Quantity Range */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-muted-foreground mb-1.5 block">
                    최소 재고
                  </Label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={filters.minQty}
                    onChange={(e) => updateFilter("minQty", e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground mb-1.5 block">
                    최대 재고
                  </Label>
                  <Input
                    type="number"
                    placeholder="무제한"
                    value={filters.maxQty}
                    onChange={(e) => updateFilter("maxQty", e.target.value)}
                  />
                </div>
              </div>

              {/* Price Range */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-muted-foreground mb-1.5 block">
                    최소 가격
                  </Label>
                  <Input
                    type="number"
                    placeholder="$0"
                    value={filters.minPrice}
                    onChange={(e) => updateFilter("minPrice", e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground mb-1.5 block">
                    최대 가격
                  </Label>
                  <Input
                    type="number"
                    placeholder="무제한"
                    value={filters.maxPrice}
                    onChange={(e) => updateFilter("maxPrice", e.target.value)}
                  />
                </div>
              </div>

              {/* Reset */}
              <div className="pt-2">
                <Button variant="ghost" onClick={onReset} className="w-full">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  필터 초기화
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
