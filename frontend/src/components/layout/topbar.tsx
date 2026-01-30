"use client";

import React, { useState, useRef, useEffect } from "react";
import { clearAccessToken, getAccessToken, apiGet } from "@/lib/api";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Bell,
  User,
  Settings,
  LogOut,
  Moon,
  Sun,
  Command,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

type NotificationItem = {
  id: number;
  eventType: string;
  payload: unknown; // ✅ any -> unknown
  createdAt: string;
};

interface TopbarProps {
  onOpenCommandPalette: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

const pageTitles: Record<string, string> = {
  "/dashboard": "대시보드",
  "/products": "제품",
  "/alerts": "알림",
  "/settings": "설정",
};

// ✅ unknown 안전 처리용 유틸
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getStr(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function getNum(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === "number" ? v : undefined;
}

function getOneOfStr(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v); // id 같은 경우 숫자도 허용
  }
  return undefined;
}

const fmtPrice = (v: unknown) =>
  typeof v === "number" ? `₩${v.toLocaleString()}` : "₩-";

const fmtQty = (v: unknown) =>
  typeof v === "number" ? `${v.toLocaleString()}개` : "-개";

export function Topbar({ onOpenCommandPalette, searchInputRef }: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);

  const { resolvedTheme, setTheme } = useTheme();

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [hasNew, setHasNew] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // ✅ effect에서 setState로 토큰 세팅 금지 → lazy init
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const isAuthed = !!token;

  const [userEmail, setUserEmail] = useState<string | null>(null);

  const pageTitle = pathname.startsWith("/products/")
    ? "제품 상세"
    : pageTitles[pathname] || "StockPulse";

  const LAST_SEEN_KEY = "notifications:lastSeenId";

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ✅ token이 있을 때만 "비동기 결과"로 setState
  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    (async () => {
      try {
        const me = await apiGet<{ email: string }>("/auth/me");
        if (!cancelled) setUserEmail(me.email);
      } catch {
        // noop
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // ✅ 알림 SSE: token 있을 때만 구독
  useEffect(() => {
    if (!token) return;

    const fetchInitial = async () => {
      try {
        const res = await apiGet<{ items: NotificationItem[] }>(
          "/search/notifications?limit=10",
        );
        setNotifications(res.items);

        const newestId = res.items?.[0]?.id ?? 0;
        const lastSeenId = Number(localStorage.getItem(LAST_SEEN_KEY) ?? "0");
        setHasNew(newestId > lastSeenId);
      } catch (e) {
        console.error(e);
      }
    };

    fetchInitial();

    const base =
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

    const lastSeenId = Number(localStorage.getItem(LAST_SEEN_KEY) ?? "0");
    const url =
      `${base}/search/notifications/stream` +
      `?after_id=${lastSeenId}&limit=10&token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);

    es.addEventListener("notification", (e: MessageEvent) => {
      const item: NotificationItem = JSON.parse(e.data) as NotificationItem;

      setNotifications((prev) => {
        if (prev.some((x) => x.id === item.id)) return prev;
        return [item, ...prev].slice(0, 20);
      });

      setHasNew(true);
    });

    es.onerror = (err) => {
      console.error("SSE error:", err);
    };

    return () => {
      es.close();
    };
  }, [token]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim()) {
      router.push(`/products?q=${encodeURIComponent(searchValue.trim())}`);
    }
  };

  const formatRelativeTime = (iso: string) => {
    const diffMs = now - new Date(iso).getTime();
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) return `${diffSec}초 전`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}분 전`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}시간 전`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}일 전`;
  };

  const toMessage = (n: NotificationItem) => {
    const p = isRecord(n.payload) ? n.payload : {};

    const name = getStr(p, "name") ?? "제품";
    const categoryStr = getStr(p, "category");
    const category = categoryStr ? `(${categoryStr})` : "";

    const productId =
      getOneOfStr(p, ["productId", "product_id"]) ?? undefined;

    switch (n.eventType) {
      case "PRODUCT_CREATED":
        return `새 제품 추가됨: ${name} ${category} · 재고 ${fmtQty(
          getNum(p, "qty"),
        )} · ${fmtPrice(getNum(p, "price"))}${
          productId ? ` · #${productId}` : ""
        }`;

      case "PRODUCT_UPDATED":
        return `제품 정보 수정됨: ${name} ${category} · ${fmtPrice(
          getNum(p, "price"),
        )}${productId ? ` · #${productId}` : ""}`;

      case "PRODUCT_DELETED":
        return `제품 삭제됨: ${name} ${category}${
          productId ? ` · #${productId}` : ""
        }`;

      case "STOCK_ADJUSTED": {
        const delta = getNum(p, "delta") ?? 0;
        const sign = delta > 0 ? "+" : "";

        const before = getNum(p, "beforeQty");
        const after = getNum(p, "afterQty");

        const type = getStr(p, "type"); // "in" | "out" | ...
        const actionText =
          type === "in" ? "입고" : type === "out" ? "출고" : "조정";

        const quantity = getNum(p, "quantity");
        const qtyText = typeof quantity === "number" ? `${quantity.toLocaleString()}개` : "";

        const rangeText =
          typeof before === "number" && typeof after === "number"
            ? `(${before} → ${after})`
            : "";

        return `재고 ${actionText}: ${name} ${category} · ${qtyText} (${sign}${delta}개) ${rangeText}${
          productId ? ` · #${productId}` : ""
        }`;
      }

      default:
        return `이벤트: ${n.eventType}`;
    }
  };

  return (
    <header className="h-16 bg-background border-b border-border flex items-center justify-between px-6 sticky top-0 z-30">
      {/* Page Title */}
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-foreground">{pageTitle}</h1>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex-1 max-w-md mx-8">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="제품 검색..."
            className="w-full h-10 pl-10 pr-20 bg-muted/50 border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-mono bg-background text-muted-foreground rounded border border-border">
            /
          </kbd>
        </div>
      </form>

      {/* Right Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenCommandPalette}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted rounded-lg border border-input transition-colors"
        >
          <Command className="w-3.5 h-3.5" />
          <span>명령</span>
          <kbd className="ml-1 px-1.5 py-0.5 text-xs font-mono bg-background rounded border border-border">
            K
          </kbd>
        </button>

        {/* Notifications */}
        <div className="relative" ref={notificationRef}>
          <button
            onClick={() => {
              const next = !showNotifications;
              setShowNotifications(next);

              if (next) {
                const newestId = notifications?.[0]?.id ?? 0;
                localStorage.setItem(LAST_SEEN_KEY, String(newestId));
                setHasNew(false);
              }
            }}
            className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Bell className="w-5 h-5" />
            {hasNew && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full" />
            )}
          </button>

          <AnimatePresence>
            {showNotifications && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-lg overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-border">
                  <h3 className="font-semibold text-foreground">알림</h3>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                      알림이 없습니다
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className="px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border last:border-0"
                      >
                        <p className="text-sm text-foreground">
                          {toMessage(notif)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {notif.createdAt
                            ? formatRelativeTime(notif.createdAt)
                            : ""}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User Menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <User className="w-4 h-4 text-emerald-500" />
            </div>
          </button>

          <AnimatePresence>
            {showUserMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-56 bg-card border border-border rounded-xl shadow-lg overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowUserMenu(false);
                    if (!isAuthed) router.push("/login");
                  }}
                  className="w-full text-left px-4 py-3 border-b border-border hover:bg-muted/50 transition-colors"
                >
                  {isAuthed ? (
                    <>
                      <p className="font-medium text-foreground">로그인됨</p>
                      <p className="text-sm text-muted-foreground">
                        {userEmail ?? "사용자"}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-foreground">
                        로그인이 필요합니다
                      </p>
                      <p className="text-sm text-muted-foreground">
                        계정으로 접속하세요
                      </p>
                    </>
                  )}
                </button>

                <div className="p-2">
                  <button
                    onClick={() => {
                      setTheme(resolvedTheme === "dark" ? "light" : "dark");
                      setShowUserMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-foreground hover:bg-muted transition-colors"
                  >
                    {resolvedTheme === "dark" ? (
                      <Sun className="w-4 h-4" />
                    ) : (
                      <Moon className="w-4 h-4" />
                    )}
                    <span className="text-sm">
                      {resolvedTheme === "dark" ? "라이트 모드" : "다크 모드"}
                    </span>
                  </button>

                  <button
                    onClick={() => {
                      router.push("/settings");
                      setShowUserMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-foreground hover:bg-muted transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    <span className="text-sm">설정</span>
                  </button>

                  <div className="my-1 border-t border-border" />

                  {isAuthed ? (
                    <button
                      onClick={() => {
                        clearAccessToken();
                        setNotifications([]);
                        setHasNew(false);
                        setUserEmail(null);
                        setToken(null);
                        setShowUserMenu(false);
                        window.location.href = "/dashboard";
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-red-500 hover:bg-red-500/10 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      <span className="text-sm">로그아웃</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        router.push("/login");
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                    >
                      <User className="w-4 h-4" />
                      <span className="text-sm">로그인</span>
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}