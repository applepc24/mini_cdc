"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SlackSettingsOut = {
  is_enabled: boolean;
  channel_name?: string | null;
  webhook_masked: string;
};

type SlackTestResult = {
  ok: boolean;
  status_code?: number | null;
  error?: string | null;
};

function getStoredToken(): string {
  if (typeof window === "undefined") return "";
  return (
    window.localStorage.getItem("accessToken") ||
    window.localStorage.getItem("token") ||
    ""
  );
}

function makeAuthHeaders(token: string): Record<string, string> {
  const t = (token || "").trim();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function joinUrl(base: string, path: string): string {
  const b = (base || "").trim().replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

export function SlackSettingsCard({
  itemVariants,
}: {
  itemVariants?: Variants; // ✅ any 제거
}) {
  // ✅ hydration mismatch 방지: mounted 이후에만 window 기반 정보 사용
  const [mounted, setMounted] = useState(false);

  // ✅ SSR/CSR 첫 렌더 동일: null로 시작
  const [connected, setConnected] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  const [apiBase, setApiBase] = useState<string>(
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000",
  );
  const [token, setToken] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<SlackSettingsOut | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setMounted(true);

    // localStorage 토큰 자동 채우기
    setToken(getStoredToken());

    // ✅ URLSearchParams도 클라이언트에서만 읽기
    const sp = new URLSearchParams(window.location.search);
    setConnected(sp.get("connected"));
    setReason(sp.get("reason"));
  }, []);

  const headers = useMemo(() => makeAuthHeaders(token), [token]);

  async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(joinUrl(apiBase, path), init);
    const text = await res.text();

    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }

    if (!res.ok) {
      const errMsg =
        typeof data === "object" && data && "detail" in data
          ? String((data as { detail: unknown }).detail)
          : `${res.status} ${res.statusText}`;
      throw new Error(errMsg);
    }
    return data as T;
  }

  async function onReadSettings() {
    setLoading(true);
    setMsg("");
    try {
      const data = await fetchJson<SlackSettingsOut>("/slack/settings", {
        method: "GET",
        headers,
      });
      setSettings(data);
      setMsg("설정 조회 성공");
    } catch (e) {
      setSettings(null);
      setMsg(`GET /slack/settings failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function onStartOAuth() {
    setLoading(true);
    setMsg("");

    try {
      if (!token.trim()) {
        throw new Error("로그인 토큰이 없습니다. (로그인 후 다시 시도)");
      }

      // ✅ 옵션 B: JSON으로 authorize_url 받기
      const data = await fetchJson<{ authorize_url: string }>(
        "/slack/oauth/start",
        {
          method: "GET",
          headers,
        },
      );

      if (!data?.authorize_url) {
        throw new Error("authorize_url missing");
      }

      window.location.href = data.authorize_url;
    } catch (e) {
      setMsg(`OAuth 시작 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function onTest() {
    setLoading(true);
    setMsg("");
    try {
      const data = await fetchJson<SlackTestResult>("/slack/settings/test", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      setMsg(
        data.ok
          ? "테스트 성공: Slack으로 메시지를 보냈습니다."
          : `테스트 실패: ${data.error ?? ""}`,
      );
    } catch (e) {
      setMsg(`POST /slack/settings/test failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  function onSaveTokenToLocalStorage() {
    const t = token.trim();
    if (!t) return;
    window.localStorage.setItem("accessToken", t);
    window.localStorage.setItem("token", t);
    setMsg("localStorage에 토큰을 저장했습니다.");
  }

  const statusBadge = (() => {
    if (!settings)
      return { text: "미확인", className: "bg-muted text-muted-foreground" };
    if (settings.is_enabled && settings.webhook_masked) {
      return {
        text: "연결됨",
        className: "bg-emerald-500/15 text-emerald-600",
      };
    }
    return { text: "연결 안 됨", className: "bg-amber-500/15 text-amber-600" };
  })();

  //  mounted 이후에만 배너 렌더
  const showOAuthBanner = mounted && (connected === "1" || connected === "0");

  return (
    <motion.div
      variants={itemVariants}
      className="bg-card rounded-xl border border-border p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Slack 알림</h2>
          <p className="text-sm text-muted-foreground mt-1">
            CSV 업로드 결과를 Slack 채널로 요약 전송합니다.
          </p>
        </div>

        <span
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium",
            statusBadge.className,
          )}
        >
          {statusBadge.text}
        </span>
      </div>

      {/* OAuth redirect result banner */}
      {showOAuthBanner && (
        <div
          className={cn(
            "mt-4 rounded-lg border p-3 text-sm",
            connected === "1"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
              : "border-rose-500/30 bg-rose-500/10 text-rose-700",
          )}
        >
          {connected === "1" ? (
            <div>Slack OAuth 연결이 완료되었습니다.</div>
          ) : (
            <div>Slack OAuth 연결 실패{reason ? `: ${reason}` : ""}</div>
          )}
          <div className="mt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={onReadSettings}
              disabled={loading}
            >
              연결 상태 새로고침
            </Button>
          </div>
        </div>
      )}

      {/* Main actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onReadSettings} disabled={loading} variant="secondary">
          상태 조회
        </Button>
        <Button onClick={onStartOAuth} disabled={loading}>
          Slack 연결하기
        </Button>
        <Button onClick={onTest} disabled={loading} variant="outline">
          테스트 보내기
        </Button>

        <Button
          type="button"
          variant="ghost"
          onClick={() => setShowAdvanced((v) => !v)}
          className="ml-auto"
        >
          {showAdvanced ? "고급 설정 닫기" : "고급 설정"}
        </Button>
      </div>

      {/* Status view */}
      <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4 text-sm">
        {!settings ? (
          <div className="text-muted-foreground">
            아직 조회되지 않았습니다. <b>상태 조회</b>를 눌러주세요.
          </div>
        ) : (
          <div className="space-y-1">
            <div>
              is_enabled: <b>{String(settings.is_enabled)}</b>
            </div>
            <div>
              channel_name: <b>{settings.channel_name ?? "(unknown)"}</b>
            </div>
            <div className="truncate">
              webhook: <code>{settings.webhook_masked}</code>
            </div>
          </div>
        )}
      </div>

      {/* Advanced */}
      {showAdvanced && (
        <div className="mt-4 space-y-4 rounded-lg border border-border p-4">
          <div>
            <Label className="mb-2 block">API Base URL</Label>
            <Input
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="http://127.0.0.1:8000"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              운영 환경에서는 <code>NEXT_PUBLIC_API_BASE_URL</code>로 고정하는
              게 좋아요.
            </p>
          </div>

          <div>
            <Label className="mb-2 block">Bearer Token</Label>
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="eyJhbGciOi..."
            />
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={onSaveTokenToLocalStorage}
              >
                localStorage 저장
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setToken(getStoredToken())}
              >
                localStorage에서 불러오기
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              개발용. 실제 서비스에서는 로그인/세션에서 자동으로 처리하도록
              바꾸면 됩니다.
            </p>
          </div>
        </div>
      )}

      {/* Message */}
      {msg && (
        <div className="mt-4 rounded-lg border border-border bg-muted p-3 text-sm whitespace-pre-wrap">
          {msg}
        </div>
      )}
    </motion.div>
  );
}
