"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Package,
  AlertTriangle,
  Box,
  Clock,
  ArrowRight,
  TrendingDown,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { CardSkeleton, ChartSkeleton } from "@/components/ui/skeleton-loader";
import { apiGet } from "@/lib/api";
import { getStockStatus } from "@/lib/utils/stock";
import { useSettings } from "@/hooks/use-settings";
import type { Product } from "@/lib/types";
import { PUBLIC_OWNER_ID } from "@/lib/publicOwner";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

type DashboardResponse = {
  totalProducts: number;
  lowStockCount: number;
  totalQty: number;
  topCategories: { category: string; count: number }[];
};

type SearchListResponse<T> = {
  count: number;
  items: T[];
};

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [recentProducts, setRecentProducts] = useState<Product[]>([]);
  const [lowStockTop5, setLowStockTop5] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);

  const { settings } = useSettings();

  useEffect(() => {
    const fetchAll = async () => {
      // ✅ 한 번만 읽기
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("accessToken")
          : null;

      const ownerId = PUBLIC_OWNER_ID;

      try {
        setLoading(true);

        const dash = await apiGet<DashboardResponse>(
          `/dashboard?owner_id=${ownerId}`,
        );
        setDashboard(dash);

        const recent = await apiGet<SearchListResponse<Product>>(
          `/products?owner_id=${ownerId}&limit=10&offset=0`,
        );
        setRecentProducts(recent.items);

        const low = await apiGet<SearchListResponse<Product>>(
          `/alerts/low-stock?owner_id=${ownerId}&threshold=${settings.threshold}&limit=5`,
        );
        setLowStockTop5(low.items);

        const all = await apiGet<SearchListResponse<Product>>(
          `/products?owner_id=${ownerId}&limit=200&offset=0`,
        );
        setAllProducts(all.items);
      } catch (e: any) {
        console.error(e);

        // ✅ 로그인된 상태(token 존재)에서만 401이면 로그인으로
        if (token && String(e?.message ?? "").includes("API Error 401")) {
          window.location.href = "/login";
        }
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [settings.threshold]);

  const kpis = useMemo(() => {
    if (!dashboard) return [];

    return [
      {
        label: "전체 제품",
        value: dashboard.totalProducts,
        icon: Package,
        color: "text-blue-500",
        bgColor: "bg-blue-500/10",
      },
      {
        label: "재고 부족",
        value: dashboard.lowStockCount,
        icon: AlertTriangle,
        color: "text-orange-500",
        bgColor: "bg-orange-500/10",
      },
      {
        label: "총 재고 수량",
        value: dashboard.totalQty.toLocaleString(),
        icon: Box,
        color: "text-emerald-500",
        bgColor: "bg-emerald-500/10",
      },
      {
        label: "오늘 업데이트",
        value: recentProducts.filter((p) => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const updated = new Date(p.updated_at);
          updated.setHours(0, 0, 0, 0);
          return updated.getTime() === today.getTime();
        }).length,
        icon: Clock,
        color: "text-violet-500",
        bgColor: "bg-violet-500/10",
      },
    ];
  }, [dashboard, recentProducts]);

  const categoryData = useMemo(() => {
    if (!dashboard) return [];

    return dashboard.topCategories
      .map((c) => ({ name: c.category, value: c.count }))
      .slice(0, 8);
  }, [dashboard]);

  const stockStatusData = useMemo(() => {
    const counts = { 품절: 0, 위험: 0, 부족: 0, 정상: 0 };

    allProducts.forEach((p) => {
      const status = getStockStatus(p.qty, settings.threshold);
      switch (status) {
        case "out-of-stock":
          counts["품절"]++;
          break;
        case "danger":
          counts["위험"]++;
          break;
        case "warning":
          counts["부족"]++;
          break;
        case "normal":
          counts["정상"]++;
          break;
      }
    });

    return [
      { name: "품절", value: counts["품절"], color: "#ef4444" },
      { name: "위험", value: counts["위험"], color: "#f97316" },
      { name: "부족", value: counts["부족"], color: "#eab308" },
      { name: "정상", value: counts["정상"], color: "#22c55e" },
    ].filter((d) => d.value > 0);
  }, [allProducts, settings.threshold]);

  if (loading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartSkeleton />
            <ChartSkeleton />
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
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((kpi, index) => (
            <motion.div
              key={kpi.label}
              variants={itemVariants}
              className="bg-card rounded-xl border border-border p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-muted-foreground">
                  {kpi.label}
                </span>
                <div
                  className={`w-10 h-10 rounded-lg ${kpi.bgColor} flex items-center justify-center`}
                >
                  <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                </div>
              </div>
              <p className="text-3xl font-semibold text-foreground">
                {kpi.value}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <motion.div
            variants={itemVariants}
            className="bg-card rounded-xl border border-border p-6"
          >
            <h3 className="text-lg font-semibold text-foreground mb-4">
              카테고리별 제품
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  type="number"
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={100}
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    color: "var(--foreground)",
                  }}
                />
                <Bar dataKey="value" fill="#22c55e" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="bg-card rounded-xl border border-border p-6"
          >
            <h3 className="text-lg font-semibold text-foreground mb-4">
              재고 상태 분포
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={stockStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {stockStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    color: "var(--foreground)",
                  }}
                />
                <Legend
                  formatter={(value) => (
                    <span style={{ color: "var(--foreground)" }}>{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        {/* Tables Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Updates */}
          <motion.div
            variants={itemVariants}
            className="bg-card rounded-xl border border-border overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">
                최근 업데이트
              </h3>
              <Link href="/products">
                <Button variant="ghost" size="sm">
                  전체 보기 <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
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
                      재고
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentProducts.map((product) => (
                    <tr
                      key={product.product_id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/products/${product.product_id}`}
                          className="text-sm font-medium text-foreground hover:text-primary"
                        >
                          {product.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {product.category}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <StatusBadge
                          status={getStockStatus(
                            product.qty,
                            settings.threshold,
                          )}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>

          {/* Low Stock Alert */}
          <motion.div
            variants={itemVariants}
            className="bg-card rounded-xl border border-border overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-orange-500" />
                재고 부족 알림
              </h3>
              <Link href="/alerts">
                <Button variant="ghost" size="sm">
                  전체 보기 <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
            <div className="p-4 space-y-3">
              {lowStockTop5.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  재고 부족 항목 없음
                </div>
              ) : (
                lowStockTop5.map((product) => (
                  <Link
                    key={product.product_id}
                    href={`/products/${product.product_id}`}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {product.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {product.category}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground">
                        {product.qty}개
                      </span>
                      <StatusBadge
                        status={getStockStatus(product.qty, settings.threshold)}
                      />
                    </div>
                  </Link>
                ))
              )}
            </div>
          </motion.div>
        </div>

        {/* Action Buttons */}
        <motion.div variants={itemVariants} className="flex gap-4">
          <Link href="/products">
            <Button>
              <Package className="w-4 h-4 mr-2" />
              전체 제품 보기
            </Button>
          </Link>
          <Link href="/alerts">
            <Button variant="outline">
              <AlertTriangle className="w-4 h-4 mr-2" />
              재고 알림 보기
            </Button>
          </Link>
        </motion.div>
      </motion.div>
    </AppLayout>
  );
}
