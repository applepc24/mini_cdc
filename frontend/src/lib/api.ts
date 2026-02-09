// src/lib/api.ts
import type { CsvUploadDetailOut, CsvUploadOut } from "@/lib/types";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("accessToken");
}

export function setAccessToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("accessToken", token);
}

export function clearAccessToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("accessToken");
}

function normalizePath(path: string) {
  if (!path.startsWith("/")) return `/${path}`;
  return path;
}

function isAiPath(path: string) {
  const p = normalizePath(path);
  return p.startsWith("/ai/");
}

function isCsvUploadsPath(path: string) {
  const p = normalizePath(path);
  return p.startsWith("/csv-uploads");
}

// ✅ 읽기 요청(= read model)은 토큰 유무에 따라 /public vs /search로
function scopeRead(path: string) {
  const p = normalizePath(path);
  const token = getAccessToken();
  return `${token ? "/search" : "/public"}${p}`;
}

// ✅ writer 요청은 토큰 필수(우리는 csv-uploads도 로그인 필수로 막을 거라 여기에 포함)
function isWriterPath(path: string) {
  const p = normalizePath(path);
  return (
    p.startsWith("/products") ||
    p.startsWith("/ai/") ||
    p.startsWith("/csv-uploads")
  );
}

function resolvePath(path: string, method: string) {
  const p = normalizePath(path);

  // auth/health는 항상 그대로
  if (p.startsWith("/auth") || p === "/health") return p;

  // ✅ csv-uploads는 prefix 붙이면 안 됨 (항상 그대로)
  if (p.startsWith("/csv-uploads")) return p;

  // ai는 그대로
  if (p.startsWith("/ai/")) return p;

  // 이미 prefix가 붙어있으면 그대로
  if (p.startsWith("/public") || p.startsWith("/search")) return p;

  // ✅ products는 특수: GET은 read로, 나머지는 writer로
  if (p.startsWith("/products")) {
    if (method === "GET") return scopeRead(p); // /public/products or /search/products
    return p; // POST/PUT/DELETE => writer
  }

  // 나머지 read API는 토큰 유무로 분기
  return scopeRead(p);
}

// ✅ body를 unknown으로 받기 위한 확장 타입
type RequestInitWithBody = Omit<RequestInit, "body"> & { body?: unknown };

function isFormDataBody(body: unknown): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function isStringBody(body: unknown): body is string {
  return typeof body === "string";
}

async function request<T>(
  path: string,
  init: RequestInitWithBody = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const token = getAccessToken();

  // ✅ writer인데 토큰 없으면 프론트에서 바로 막기 (서버 로그도 깨끗)
  if (method !== "GET" && isWriterPath(path) && !token) {
    throw new Error("AUTH_REQUIRED");
  }

  // ✅ csv-uploads는 GET이어도 로그인 필수
  if (isCsvUploadsPath(path) && !token) {
    throw new Error("AUTH_REQUIRED");
  }

  // ✅ ai는 항상 로그인 필요
  if (isAiPath(path) && !token) {
    throw new Error("AUTH_REQUIRED");
  }

  const body = init.body;
  const isFormData = isFormDataBody(body);

  // ✅ headers 만들기 (RequestInit.headers는 다양한 타입이라 Headers로 통일)
  const headers = new Headers(init.headers);

  if (token) headers.set("Authorization", `Bearer ${token}`);

  // body가 있고, FormData가 아니고, Content-Type이 아직 없으면 JSON으로
  if (!isFormData && body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // ✅ body 처리:
  // - FormData: 그대로
  // - string: 그대로
  // - object: JSON.stringify
  const finalBody: BodyInit | null | undefined =
    body === undefined
      ? undefined
      : isFormData
        ? body
        : isStringBody(body)
          ? body
          : JSON.stringify(body);

  const finalPath = resolvePath(path, method);

  const res = await fetch(`${BASE_URL}${finalPath}`, {
    ...init,
    headers,
    body: finalBody,
    cache: "no-store",
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("accessToken");
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API Error ${res.status}: ${text}`);
  }

  // ✅ 204 No Content 같은 케이스 대비
  if (res.status === 204) {
    return undefined as unknown as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    return text as unknown as T;
  }

  return (await res.json()) as T;
}

export function apiGet<T>(path: string) {
  return request<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body: unknown) {
  return request<T>(path, { method: "POST", body });
}

export function apiPut<T>(path: string, body: unknown) {
  return request<T>(path, { method: "PUT", body });
}

export function apiDelete<T>(path: string) {
  return request<T>(path, { method: "DELETE" });
}

/**
 * ✅ apiUpload는 유지해도 되고,
 * 이제는 그냥 apiPost("/products/import", formData)로도 업로드 가능.
 * (다만 "절대 URL"이 필요할 때 편해서 남겨둬도 OK)
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  const token =
    typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;

  const url = path.startsWith("http") ? path : `${base}${path}`;

  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // ✅ FormData는 Content-Type을 직접 지정하면 boundary 깨짐. 지정하지 말 것.

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API Error ${res.status}: ${text || res.statusText}`);
  }

  return (await res.json()) as T;
}

// =======================
// CSV Uploads APIs
// =======================
export function fetchCsvUploads(limit = 20, offset = 0) {
  return apiGet<CsvUploadOut[]>(`/csv-uploads?limit=${limit}&offset=${offset}`);
}

export function fetchCsvUploadDetail(uploadId: number, limit = 200, offset = 0) {
  return apiGet<CsvUploadDetailOut>(
    `/csv-uploads/${uploadId}?limit=${limit}&offset=${offset}`,
  );
}