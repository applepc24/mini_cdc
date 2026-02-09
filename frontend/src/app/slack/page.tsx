"use client";

import React, { useEffect, useMemo, useState } from "react";

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
  const headers: Record<string, string> = {};
  const t = (token || "").trim();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  return headers;
}

function joinUrl(base: string, path: string): string {
  const b = (base || "").trim().replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

export default function SlackPage() {
  const urlParams = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);

  const connected = urlParams.get("connected"); // "1" | "0" | null
  const reason = urlParams.get("reason");

  const [apiBase, setApiBase] = useState<string>("http://127.0.0.1:8000");
  const [token, setToken] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<SlackSettingsOut | null>(null);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    // localStorage에서 자동 채우기
    setToken(getStoredToken());
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
    setMsg("");
    if (!token.trim()) {
      setMsg("Bearer 토큰이 비어있음 (로그인 후 localStorage에 넣었는지 확인)");
      return;
    }

    // 서버가 307로 Slack authorize URL로 보내줌
    // fetch로 따라가면 CORS/리다이렉트 문제 생기니, 브라우저 이동으로 처리
    const startUrl = joinUrl(apiBase, "/slack/oauth/start");
    window.location.href = startUrl; // Authorization 헤더가 필요하므로 아래 방식으로 보냄이 맞지만, 브라우저 이동은 헤더를 못 붙임
  }

  async function onStartOAuthByFetch() {
    // ✅ Authorization 헤더를 붙여서 start를 호출하고,
    // 응답의 최종 location(리다이렉트 URL)을 받아서 거기로 이동
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(joinUrl(apiBase, "/slack/oauth/start"), {
        method: "GET",
        headers,
        redirect: "manual",
      });

      const loc = res.headers.get("location");
      if (!loc) {
        const t = await res.text();
        throw new Error(`no location (status=${res.status}) ${t.slice(0, 200)}`);
      }
      window.location.href = loc;
    } catch (e) {
      setMsg(`OAuth start failed: ${(e as Error).message}`);
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
      setMsg(data.ok ? "테스트 성공(슬랙에 메시지 전송됨)" : `테스트 실패: ${data.error ?? ""}`);
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
    setMsg("localStorage에 토큰 저장 완료");
  }

  return (
    <div style={{ maxWidth: 760, margin: "24px auto", padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Slack 연결</h1>

      <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12, marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>현재 상태</div>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          {connected === "1" && <div>OAuth 성공: <code>/slack?connected=1</code></div>}
          {connected === "0" && (
            <div>
              OAuth 실패: <code>/slack?connected=0</code>
              {reason ? <> (<b>{reason}</b>)</> : null}
            </div>
          )}
          {connected === null && <div>설정 조회를 눌러 상태를 가져오세요.</div>}
        </div>
      </div>

      <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>API Base URL</div>
          <input
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            placeholder="http://127.0.0.1:8000"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Bearer TOKEN</div>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="eyJhbGciOi..."
            rows={3}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          />
          <div style={{ fontSize: 12, color: "#666" }}>
            * 토큰을 localStorage에 저장해두면 자동으로 채워집니다.
          </div>
          <button
            onClick={onSaveTokenToLocalStorage}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer", width: "fit-content" }}
          >
            토큰 localStorage 저장
          </button>
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <button
          disabled={loading}
          onClick={onReadSettings}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}
        >
          설정 조회
        </button>

        <button
          disabled={loading}
          onClick={onStartOAuthByFetch}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}
        >
          Slack 연결 시작(OAuth)
        </button>

        <button
          disabled={loading}
          onClick={onTest}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}
        >
          테스트 보내기
        </button>
      </div>

      {msg && (
        <div style={{ padding: 12, background: "#f6f6f6", borderRadius: 12, marginBottom: 16, whiteSpace: "pre-wrap" }}>
          {msg}
        </div>
      )}

      <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>설정 상태</div>
        {!settings ? (
          <div style={{ fontSize: 14, color: "#666" }}>아직 조회 안됨</div>
        ) : (
          <div style={{ fontSize: 14, lineHeight: 1.8 }}>
            <div>is_enabled: <b>{String(settings.is_enabled)}</b></div>
            <div>channel_name: <b>{settings.channel_name ?? "(none)"}</b></div>
            <div>webhook: <code>{settings.webhook_masked}</code></div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, fontSize: 12, color: "#666" }}>
        <div>참고: OAuth 시작은 <code>/slack/oauth/start</code>가 307로 Slack authorize URL로 리다이렉트 합니다.</div>
        <div>그래서 fetch로 Location을 받아 <b>window.location.href = location</b>로 이동하는 방식이 가장 안정적입니다.</div>
      </div>
    </div>
  );
}