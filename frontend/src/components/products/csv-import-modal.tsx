"use client";

import { useMemo, useRef, useState } from "react";
import { apiUpload, getAccessToken } from "@/lib/api";
import { Button } from "@/components/ui/button";

type ImportResponse = {
  inserted: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
};

const REQUIRED_HEADERS = ["name", "category", "price", "qty"] as const;

function parseCsvHeader(text: string) {
  // BOM 제거 + 첫 줄만 파싱
  const cleaned = text.replace(/^\uFEFF/, "");
  const firstLine = cleaned.split(/\r?\n/)[0] ?? "";
  return firstLine.split(",").map((s) => s.trim());
}
function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return "CSV 업로드 실패";
}

export function CsvImportModal({
  isOpen,
  onClose,
  onImported,
}: {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [header, setHeader] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<ImportResponse | null>(null);

  const headerOk = useMemo(() => {
    if (!header) return false;
    const set = new Set(header.map((h) => h.toLowerCase()));
    return REQUIRED_HEADERS.every((h) => set.has(h));
  }, [header]);

  if (!isOpen) return null;

  const reset = () => {
    setFile(null);
    setHeader(null);
    setSubmitting(false);
    setError("");
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePick = async (f: File | null) => {
    setError("");
    setResult(null);
    setFile(f);
    setHeader(null);

    if (!f) return;

    try {
      // ✅ 간단 검증(헤더 존재 여부)
      const text = await f.text();
      const hdr = parseCsvHeader(text);
      setHeader(hdr);
    } catch (e) {
      setError("파일을 읽을 수 없습니다. 다른 CSV로 시도해 주세요.");
    }
  };

  const handleUpload = async () => {
    // ✅ 정책: 로그인 안 했으면 아무 반응(=아무 동작도 하지 않음)
    const token = getAccessToken();
    if (!token) return;

    if (!file || !headerOk) return;

    setError("");
    setSubmitting(true);

    try {
      const form = new FormData();
      form.append("file", file);

      // ✅ writer endpoint: /products/import
      const res = await apiUpload<ImportResponse>("/products/import", form);

      setResult(res);

      // ✅ 성공하면 목록 새로고침 + 모달 닫기
      onImported();
      reset();
      onClose();
    } catch (e: unknown) {
      const msg = getErrorMessage(e);

      // ✅ 정책: 로그인/권한 문제여도 이동하지 않고 조용히 종료(원하면 메시지만)
      if (
        msg.includes("401") ||
        msg.includes("403") ||
        msg.includes("AUTH_REQUIRED")
      ) {
        return;
      }

      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const canUpload = !!file && headerOk && !submitting;

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* overlay */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          reset();
          onClose();
        }}
      />

      {/* modal */}
      <div className="absolute left-1/2 top-1/2 w-[520px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card border border-border shadow-lg">
        <div className="p-5 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">
            CSV 가져오기
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            헤더는 반드시{" "}
            <span className="font-medium">name, category, price, qty</span> 를
            포함해야 합니다.
          </p>
        </div>

        <div className="p-5 space-y-4">
          {/* ✅ 파일 선택 UI 개선 */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => handlePick(e.target.files?.[0] ?? null)}
          />

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
            >
              파일 선택
            </Button>

            <div className="text-sm text-muted-foreground truncate">
              {file ? file.name : "선택된 파일 없음"}
            </div>
          </div>

          {header && (
            <div className="text-sm">
              <div className="text-muted-foreground mb-1">감지된 헤더</div>
              <div className="flex flex-wrap gap-2">
                {header.map((h, idx) => (
                  <span
                    key={`${h}-${idx}`}
                    className="px-2 py-1 rounded-md bg-muted text-foreground text-xs"
                  >
                    {h}
                  </span>
                ))}
              </div>

              {!headerOk && (
                <p className="mt-2 text-sm text-red-500">
                  필수 헤더({REQUIRED_HEADERS.join(", ")})가 누락되었습니다.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          {result && (
            <div className="text-sm rounded-lg bg-muted/40 p-3">
              <p className="text-foreground">
                ✅ 추가됨: <b>{result.inserted}</b> / 건너뜀:{" "}
                <b>{result.skipped}</b>
              </p>
              {result.errors?.length > 0 && (
                <div className="mt-2 max-h-32 overflow-auto text-muted-foreground">
                  {result.errors.slice(0, 20).map((x) => (
                    <div key={`${x.row}-${x.reason}`}>
                      - {x.row}행: {x.reason}
                    </div>
                  ))}
                  {result.errors.length > 20 && (
                    <div>… (총 {result.errors.length}개)</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={submitting}
          >
            닫기
          </Button>

          <Button onClick={handleUpload} disabled={!canUpload}>
            {submitting ? "업로드 중..." : "업로드"}
          </Button>
        </div>
      </div>
    </div>
  );
}
