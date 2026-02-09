"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

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

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return "요청 실패";
}

export function SlackSettingsCard({
  itemVariants,
}: {
  itemVariants?: Variants;
}) {
  // hydration mismatch 방지
  const [mounted, setMounted] = useState(false);

  const [token, setToken] = useState<string>("");

  // OAuth redirect query
  const [connected, setConnected] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<SlackSettingsOut | null>(null);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    setMounted(true);
    setToken(getStoredToken());

    const sp = new URLSearchParams(window.location.search);
    setConnected(sp.get("connected"));
    setReason(sp.get("reason"));
  }, []);

  const headers = useMemo(() => makeAuthHeaders(token), [token]);

  function requireLoginOrRedirect(): boolean {
    const t = token.trim();
    if (t) return true;

    const next = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    window.location.href = `/login?next=${next}`;
    return false;
  }

  async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(joinUrl(API_BASE, path), init);
    const text = await res.text();

    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }

    // 인증 실패면 로그인으로
    if (res.status === 401 || res.status === 403) {
      const next = encodeURIComponent(
        window.location.pathname + window.location.search,
      );
      window.location.href = `/login?next=${next}`;
      throw new Error("AUTH_REQUIRED");
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
    if (!requireLoginOrRedirect()) return;

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
      const m = getErrorMessage(e);
      if (m !== "AUTH_REQUIRED") {
        setSettings(null);
        setMsg(`상태 조회 실패: ${m}`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function onStartOAuth() {
    if (!requireLoginOrRedirect()) return;

    setLoading(true);
    setMsg("");
    try {
      const data = await fetchJson<{ authorize_url: string }>(
        "/slack/oauth/start",
        { method: "GET", headers },
      );

      if (!data?.authorize_url) throw new Error("authorize_url missing");
      window.location.href = data.authorize_url;
    } catch (e) {
      const m = getErrorMessage(e);
      if (m !== "AUTH_REQUIRED") setMsg(`Slack 연결 시작 실패: ${m}`);
    } finally {
      setLoading(false);
    }
  }

  async function onTest() {
    if (!requireLoginOrRedirect()) return;

    setLoading(true);
    setMsg("");
    try {
      const data = await fetchJson<SlackTestResult>("/slack/settings/test", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      setMsg(
        data.ok
          ? "테스트 성공: Slack으로 메시지를 보냈습니다."
          : `테스트 실패: ${data.error ?? ""}`,
      );
    } catch (e) {
      const m = getErrorMessage(e);
      if (m !== "AUTH_REQUIRED") setMsg(`테스트 실패: ${m}`);
    } finally {
      setLoading(false);
    }
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

  const showOAuthBanner = mounted && (connected === "1" || connected === "0");

  return (
    <motion.div
      variants={itemVariants}
      className="bg-card rounded-xl border border-border p-6"
      id="slack"
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
      </div>

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

      {msg && (
        <div className="mt-4 rounded-lg border border-border bg-muted p-3 text-sm whitespace-pre-wrap">
          {msg}
        </div>
      )}
    </motion.div>
  );
}