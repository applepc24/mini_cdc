"use client";

import { useState, useEffect } from "react";
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
import { apiGet, apiPost } from "@/lib/api";
import { getStockStatus } from "@/lib/utils/stock";
import { useSettings } from "@/hooks/use-settings";
import { useAppToast } from "@/hooks/use-app-toast";
import type { Product } from "@/lib/types";
import { mockProducts } from "@/lib/mock/products";

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

function getAccessToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("accessToken");
}

export default function AlertsPage() {
  type Reason = "product_sales" | "category_sales" | "threshold_fallback";

  type RestockExplanation = {
    overview: string;
    top3: string[];
    notes: string[];
    perItem: Record<number, string>;
  };

  type RestockRecommendation = {
    productId: number;
    name: string;
    category?: string | null;
    currentQty: number;
    avgDaily: number;
    targetQty: number;
    recommendIn: number;
    reason: Reason;
    windowDays: number;
    coverDays?: number | null;
  };

  type AgentResponse = {
    ok: boolean;
    summary: {
      threshold: number;
      needCount: number;
      totalInQty: number;
      byReason: Record<string, number>;
      topNeeds: {
        productId: number;
        name: string;
        recommendIn: number;
        reason: string;
      }[];
    };
    items: RestockRecommendation[];
    plan: { productId: number; quantity: number; note?: string | null }[];
    idempotency: {
      key?: string | null;
      status: "NONE" | "STARTED" | "DONE" | "FAILED" | "REUSED";
      reused: boolean;
    };
    llm?: RestockExplanation | null;
  };

  const { settings, updateSettings } = useSettings();
  const { addToast } = useAppToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [localThreshold, setLocalThreshold] = useState(settings.threshold);
  const [agent, setAgent] = useState<AgentResponse | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [explainLLM, setExplainLLM] = useState(false);

  const reasonLabel: Record<string, string> = {
    product_sales: "상품 판매 기반",
    category_sales: "카테고리 판매 기반",
    threshold_fallback: "임계값 기준(대체)",
  };

  const reasonOrder: Reason[] = [
    "product_sales",
    "category_sales",
    "threshold_fallback",
  ];

  const reasonBadge = (reason: Reason) => {
    const label = reasonLabel[reason] ?? reason;
    return label;
  };

  const fetchLowStock = async (threshold: number) => {
    setLoading(true);

    const token = getAccessToken();
    if (!token) {
      // ✅ mock 모드: threshold 기준으로 필터 + 보기좋게 정렬
      const items = mockProducts
        .filter((p) => p.qty <= threshold)
        .sort((a, b) => {
          // qty 오름차순, updated_at 내림차순
          if (a.qty !== b.qty) return a.qty - b.qty;
          return (
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          );
        });

      setProducts(items);
      setLoading(false);
      return;
    }

    try {
      const res = await apiGet<{ count: number; items: Product[] }>(
        `/alerts/low-stock?owner_id=1&threshold=${threshold}&limit=200`,
      );
      setProducts(res.items);
    } catch (e: unknown) {
      console.error(e);

      // ✅ 로그인 상태인데 401이면 로그인으로
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("API Error 401")) {
        window.location.href = "/login";
        return;
      }

      addToast("error", "재고 부족 목록 조회 실패");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const callAgentRecommend = async () => {
    const token = getAccessToken();
    if (!token) {
      addToast("error", "로그인 후 자동 재입고 추천을 사용할 수 있습니다");
      return;
    }

    setAgentLoading(true);
    try {
      const res = await apiPost<AgentResponse>(
        `/ai/restock/agent?dry_run=true&threshold=${localThreshold}&limit=200&explain_llm=${explainLLM}`,
        {},
      );
      setAgent(res);
      addToast("success", `추천 ${res.summary.needCount}건 생성됨`);
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("AUTH_REQUIRED") || msg.includes("API Error 401")) {
        addToast("error", "로그인이 필요합니다");
        return;
      }
      addToast("error", "재입고 추천 호출 실패");
    } finally {
      setAgentLoading(false);
    }
  };

  useEffect(() => {
    setLocalThreshold(settings.threshold);
  }, [settings.threshold]);

  useEffect(() => {
    fetchLowStock(settings.threshold);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const headers = ["Product ID", "Name", "Category", "Stock", "Price", "Status"];
    const rows = lowStockProducts.map((p) => [
      String(p.product_id),
      p.name,
      p.category,
      String(p.qty),
      String(p.price),
      getStockStatus(p.qty, localThreshold),
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `low-stock-report-${new Date().toISOString().split("T")[0]}.csv`;
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
                  onChange={(e) => handleThresholdChange(Number(e.target.value))}
                  className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <Input
                  id="threshold"
                  type="number"
                  min="1"
                  max="100"
                  value={localThreshold}
                  onChange={(e) => handleThresholdChange(Number(e.target.value))}
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
            onClick={callAgentRecommend}
            disabled={agentLoading}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {agentLoading ? "추천 생성 중..." : "자동 재입고 추천 보기"}
          </Button>
        </motion.div>

        {/* Agent 결과(로그인했을 때만 보통 뜸) */}
        {agent && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-card rounded-xl border border-border p-6"
          >
            <div className="flex items-start gap-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  자동 재입고 추천
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  추천 품목{" "}
                  <span className="text-foreground font-medium">
                    {agent.summary.needCount}
                  </span>
                  개 · 총 권장수량{" "}
                  <span className="text-foreground font-medium">
                    {agent.summary.totalInQty}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    checked={explainLLM}
                    onChange={(e) => setExplainLLM(e.target.checked)}
                  />
                  LLM 설명
                </label>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={callAgentRecommend}
                  disabled={agentLoading}
                >
                  {agentLoading ? "생성 중..." : "다시 생성"}
                </Button>
              </div>
            </div>

            {agent.llm && (
              <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-sm font-medium text-foreground">LLM 요약</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {agent.llm.overview}
                </p>
                {agent.llm.top3?.length > 0 && (
                  <div className="mt-3 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Top 3</span>:{" "}
                    {agent.llm.top3.join(" · ")}
                  </div>
                )}
                {agent.llm.notes?.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm text-muted-foreground list-disc pl-5">
                    {agent.llm.notes.slice(0, 3).map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {reasonOrder
                .filter((r) => (agent.summary.byReason?.[r] ?? 0) > 0)
                .map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground"
                  >
                    {reasonBadge(r as Reason)} · {agent.summary.byReason[r]}
                  </span>
                ))}
            </div>

            {agent.summary.needCount === 0 ? (
              <p className="text-sm text-muted-foreground mt-4">
                재입고가 필요한 항목이 없습니다.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">
                        품목
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">
                        카테고리
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase">
                        현재
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase">
                        목표
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase">
                        권장
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">
                        근거
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase">
                        소진(일)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {agent.items
                      .filter((x) => x.recommendIn > 0)
                      .sort((a, b) => b.recommendIn - a.recommendIn)
                      .map((x) => (
                        <tr key={x.productId} className="hover:bg-muted/30">
                          <td className="px-4 py-2">
                            <p className="text-sm font-medium text-foreground">
                              {x.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {x.productId}
                            </p>
                          </td>
                          <td className="px-4 py-2 text-sm text-muted-foreground">
                            {x.category ?? "-"}
                          </td>
                          <td className="px-4 py-2 text-sm text-foreground text-right font-medium">
                            {x.currentQty}
                          </td>
                          <td className="px-4 py-2 text-sm text-foreground text-right font-medium">
                            {x.targetQty}
                          </td>
                          <td className="px-4 py-2 text-sm text-foreground text-right font-semibold">
                            {x.recommendIn}
                          </td>
                          <td className="px-4 py-2 text-sm text-muted-foreground">
                            {reasonLabel[x.reason] ?? x.reason}
                          </td>
                          <td className="px-4 py-2 text-sm text-muted-foreground text-right">
                            {x.coverDays ?? "-"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}

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
                      key={String(product.product_id)}
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