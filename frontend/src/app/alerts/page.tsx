"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, Download, Sparkles, Settings } from "lucide-react";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CardSkeleton,
  TableRowSkeleton,
} from "@/components/ui/skeleton-loader";
import { apiGet } from "@/lib/api";
import { getStockStatus } from "@/lib/utils/stock";
import { useSettings } from "@/hooks/use-settings";
import { useAppToast } from "@/hooks/use-app-toast";
import type { Product } from "@/lib/types";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

export default function AlertsPage() {
  const { settings, updateSettings } = useSettings();
  const { addToast } = useAppToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [localThreshold, setLocalThreshold] = useState(settings.threshold);

  const fetchLowStock = async (threshold: number) => {
    setLoading(true);
    try {
      const res = await apiGet<{ count: number; items: Product[] }>(
        `/alerts/low-stock?owner_id=1&threshold=${threshold}&limit=200`
      );
      setProducts(res.items);
    } catch (e) {
      console.error(e);
      addToast("error", "재고 부족 목록 조회 실패");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLowStock(settings.threshold);
  }, [settings.threshold]);

  const lowStockProducts = products;

  const handleThresholdChange = (value: number) => {
    setLocalThreshold(value);
  };

  const applyThreshold = async () => {
    updateSettings({ threshold: localThreshold });
    addToast("success", `임계값이 ${localThreshold}개로 변경되었습니다`);
    await fetchLowStock(localThreshold);
  };

  const handleDownloadCSV = () => {
    const headers = [
      "Product ID",
      "Name",
      "Category",
      "Stock",
      "Price",
      "Status",
    ];
    const rows = lowStockProducts.map((p) => [
      p.product_id,
      p.name,
      p.category,
      p.qty.toString(),
      p.price.toFixed(2),
      getStockStatus(p.qty, localThreshold),
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `low-stock-report-${
      new Date().toISOString().split("T")[0]
    }.csv`;
    a.click();
    URL.revokeObjectURL(url);

    addToast("success", "CSV 파일이 다운로드되었습니다");
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <CardSkeleton />
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    Product
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    Category
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                    Stock
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...Array(8)].map((_, i) => (
                  <TableRowSkeleton key={i} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        {/* Alert Banner */}
        <motion.div
          variants={itemVariants}
          className={`rounded-xl border p-6 ${
            lowStockProducts.length > 0
              ? "bg-orange-500/5 border-orange-500/20"
              : "bg-emerald-500/5 border-emerald-500/20"
          }`}
        >
          <div className="flex items-start gap-4">
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center ${
                lowStockProducts.length > 0
                  ? "bg-orange-500/10"
                  : "bg-emerald-500/10"
              }`}
            >
              <AlertTriangle
                className={`w-6 h-6 ${
                  lowStockProducts.length > 0
                    ? "text-orange-500"
                    : "text-emerald-500"
                }`}
              />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-foreground mb-1">
                {lowStockProducts.length > 0
                  ? `${lowStockProducts.length}개 제품 확인 필요`
                  : "모든 제품 재고 정상"}
              </h2>
              <p className="text-muted-foreground">
                {lowStockProducts.length > 0
                  ? `임계값 ${localThreshold}개 기준으로 재고가 부족한 제품입니다.`
                  : `모든 제품의 재고가 임계값 ${localThreshold}개를 초과합니다.`}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Threshold Settings */}
        <motion.div
          variants={itemVariants}
          className="bg-card rounded-xl border border-border p-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="flex-1">
              <Label htmlFor="threshold" className="mb-2 block">
                재고 임계값
              </Label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={localThreshold}
                  onChange={(e) =>
                    handleThresholdChange(Number(e.target.value))
                  }
                  className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <Input
                  id="threshold"
                  type="number"
                  min="1"
                  max="100"
                  value={localThreshold}
                  onChange={(e) =>
                    handleThresholdChange(Number(e.target.value))
                  }
                  className="w-20"
                />
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                이 수량 이하의 재고를 가진 제품이 알림으로 표시됩니다
              </p>
            </div>
            <Button
              onClick={applyThreshold}
              disabled={localThreshold === settings.threshold}
            >
              <Settings className="w-4 h-4 mr-2" />
              임계값 적용
            </Button>
          </div>
        </motion.div>

        {/* Action Buttons */}
        <motion.div variants={itemVariants} className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleDownloadCSV}
            disabled={lowStockProducts.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            CSV 다운로드
          </Button>
          <Button
            variant="outline"
            onClick={() => addToast("info", "곧 제공될 예정입니다!")}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            자동 재입고 추천
          </Button>
        </motion.div>

        {/* Low Stock Table */}
        <motion.div
          variants={itemVariants}
          className="bg-card rounded-xl border border-border overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-lg font-semibold text-foreground">
              재고 부족 제품
            </h3>
          </div>

          {lowStockProducts.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="재고 부족 항목 없음"
              description="모든 제품의 재고가 충분합니다. 잘 관리되고 있네요!"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      상태
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      동작
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lowStockProducts.map((product, index) => (
                    <motion.tr
                      key={product.product_id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.03 }}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/products/${product.product_id}`}
                          className="hover:text-primary"
                        >
                          <p className="font-medium text-foreground">
                            {product.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {product.product_id}
                          </p>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {product.category}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground text-right font-medium">
                        {product.price.toLocaleString("ko-KR")}원
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`text-lg font-semibold ${
                            product.qty === 0
                              ? "text-red-500"
                              : product.qty < 5
                              ? "text-orange-500"
                              : "text-yellow-500"
                          }`}
                        >
                          {product.qty}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={getStockStatus(product.qty, localThreshold)}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/products/${product.product_id}`}>
                          <Button variant="ghost" size="sm">
                            관리
                          </Button>
                        </Link>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AppLayout>
  );
}
