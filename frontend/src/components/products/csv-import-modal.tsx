"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiUpload, getAccessToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CsvUploadDetailModal } from "@/components/products/csv-upload-detail-modal";

type ImportRowError = { row: number; reason: string };

export type ImportResponse = {
  ok: boolean;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  inserted: number;
  skipped: number;
  upload_id: number;
  errors: ImportRowError[];
};

type SlackSettingsOut = {
  is_enabled: boolean;
  channel_name?: string | null;
  webhook_masked: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

const REQUIRED_HEADERS = ["name", "category", "price", "qty"] as const;

type Step = "pick" | "confirm" | "done";

function downloadCsvTemplate() {
  // 파일 다운로드는 fetch보다 location 이동이 제일 간단/확실함
  window.location.href = `${API_BASE}/products/import/template`;
}

function parseCsvHeader(text: string) {
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
  onImported: (res: ImportResponse) => void | Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<Step>("pick");

  const [file, setFile] = useState<File | null>(null);
  const [header, setHeader] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<ImportResponse | null>(null);

  // ✅ 결과 상세 모달
  const [showDetail, setShowDetail] = useState(false);

  // ✅ Slack 설정 상태
  const [slackSettings, setSlackSettings] = useState<SlackSettingsOut | null>(
    null,
  );
  const [slackLoading, setSlackLoading] = useState(false);

  const headerOk = useMemo(() => {
    if (!header) return false;
    const set = new Set(header.map((h) => h.toLowerCase()));
    return REQUIRED_HEADERS.every((h) => set.has(h));
  }, [header]);

  async function fetchSlackSettings() {
    const token = getAccessToken();
    if (!token) {
      setSlackSettings(null);
      return;
    }
    setSlackLoading(true);
    try {
      const res = await fetch(`${API_BASE}/slack/settings`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        setSlackSettings(null);
        return;
      }
      const data = (await res.json()) as SlackSettingsOut;
      setSlackSettings(data);
    } catch {
      setSlackSettings(null);
    } finally {
      setSlackLoading(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    fetchSlackSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const resetAll = () => {
    setStep("pick");
    setFile(null);
    setHeader(null);
    setSubmitting(false);
    setError("");
    setResult(null);
    setShowDetail(false);

    // Slack 상태는 모달을 다시 열 때 갱신되도록 유지해도 되지만,
    // UX상 닫을 때 초기화하는게 더 직관적이면 아래 줄 활성화
    // setSlackSettings(null);

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetFileOnly = () => {
    setStep("pick");
    setSubmitting(false);
    setError("");
    setResult(null);
    setShowDetail(false);
    setFile(null);
    setHeader(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePick = async (f: File | null) => {
    setError("");
    setResult(null);
    setShowDetail(false);
    setStep("pick");
    setFile(f);
    setHeader(null);

    if (!f) return;

    try {
      const text = await f.text();
      const hdr = parseCsvHeader(text);
      setHeader(hdr);
    } catch {
      setError("파일을 읽을 수 없습니다. 다른 CSV로 시도해 주세요.");
    }
  };

  const goConfirm = () => {
    if (!file || !headerOk) return;
    setError("");
    setStep("confirm");
  };

  const handleUpload = async () => {
    const token = getAccessToken();
    if (!token) {
      setError("로그인이 필요합니다.");
      return;
    }
    if (!file || !headerOk) return;

    setError("");
    setSubmitting(true);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await apiUpload<ImportResponse>("/products/import", form);

      setResult(res);
      setStep("done");

      await onImported(res);

      // ✅ 업로드 후 Slack 설정 다시 조회(설정 변경했을 수도 있으니)
      fetchSlackSettings();
    } catch (e: unknown) {
      const msg = getErrorMessage(e);

      if (
        msg.includes("401") ||
        msg.includes("403") ||
        msg.includes("AUTH_REQUIRED")
      ) {
        setError("로그인이 필요합니다.");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const canGoConfirm = !!file && headerOk && !submitting && !result;
  const canUpload =
    step === "confirm" && !!file && headerOk && !submitting && !result;

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* overlay */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          resetAll();
          onClose();
        }}
      />

      {/* modal */}
      <div className="absolute left-1/2 top-1/2 w-[560px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card border border-border shadow-lg">
        <div className="p-5 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">
            CSV 가져오기
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            헤더는 반드시{" "}
            <span className="font-medium">name, category, price, qty</span> 를
            포함해야 합니다.
          </p>

          <div className="mt-3 text-xs text-muted-foreground">
            단계:{" "}
            <b className={step === "pick" ? "text-foreground" : ""}>미리보기</b>{" "}
            →{" "}
            <b className={step === "confirm" ? "text-foreground" : ""}>확인</b>{" "}
            → <b className={step === "done" ? "text-foreground" : ""}>결과</b>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => handlePick(e.target.files?.[0] ?? null)}
          />

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
            >
              파일 선택
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={downloadCsvTemplate}
              disabled={submitting}
            >
              CSV 템플릿 다운로드
            </Button>

            <div className="text-sm text-muted-foreground truncate">
              {file ? file.name : "선택된 파일 없음"}
            </div>

            {result && (
              <Button
                type="button"
                variant="ghost"
                onClick={resetFileOnly}
                disabled={submitting}
              >
                다른 파일로 다시 업로드
              </Button>
            )}
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

          {/* confirm panel */}
          {step === "confirm" && file && headerOk && !result && (
            <div className="text-sm rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <div className="text-foreground font-medium">✅ 업로드 확인</div>
              <div className="text-muted-foreground">
                이 파일을 실제로 반영합니다. 진행할까요?
              </div>
              <ul className="text-xs text-muted-foreground list-disc pl-5">
                <li>생성/수정/재고 반영이 즉시 적용됩니다.</li>
                <li>결과는 업로드 로그(csv-uploads)에 남습니다.</li>
              </ul>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* result panel */}
          {result && (
            <div className="text-sm rounded-lg bg-muted/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-foreground">
                  ✅ 반영: <b>{result.inserted}</b> / 스킵:{" "}
                  <b>{result.skipped}</b> / 실패: <b>{result.failed}</b>
                </p>
                <p className="text-xs text-muted-foreground">
                  upload #{result.upload_id}
                </p>
              </div>

              {(result.errors?.length ?? 0) > 0 && (
                <div className="max-h-40 overflow-auto text-muted-foreground border border-border rounded-md p-2 bg-background/40">
                  {result.errors.slice(0, 50).map((x) => (
                    <div key={`${x.row}-${x.reason}`}>
                      - {x.row}행: {x.reason}
                    </div>
                  ))}
                  {result.errors.length > 50 && (
                    <div>… (총 {result.errors.length}개)</div>
                  )}
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                created {result.created}, updated {result.updated}, unchanged{" "}
                {result.unchanged}
              </div>

              {/* ✅ Slack 안내 */}
              <div className="mt-2 rounded-md border border-border bg-background/40 p-2 text-xs text-muted-foreground">
                {slackLoading ? (
                  <div>Slack 연결 상태 확인 중...</div>
                ) : slackSettings?.is_enabled ? (
                  <div>
                    ✅ Slack 알림이 <b>켜져</b> 있어요. 업로드 요약이 채널로
                    전송됩니다.
                    {slackSettings.channel_name ? (
                      <>
                        {" "}
                        (<b>{slackSettings.channel_name}</b>)
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      Slack을 연결하면 업로드 요약을 채널로 받을 수 있어요.
                      <span className="ml-1">
                        (설정이 꺼져있거나 아직 연결되지 않았습니다)
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        window.location.href = "/settings#slack";
                      }}
                    >
                      Slack 설정
                    </Button>
                  </div>
                )}
              </div>

              {/* ✅ 업로드 상세 보기 */}
              <div className="pt-2 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowDetail(true)}
                >
                  업로드 상세 보기
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              resetAll();
              onClose();
            }}
            disabled={submitting}
          >
            닫기
          </Button>

          {step === "pick" && (
            <Button type="button" onClick={goConfirm} disabled={!canGoConfirm}>
              다음(확인)
            </Button>
          )}

          {step === "confirm" && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("pick")}
                disabled={submitting}
              >
                뒤로
              </Button>
              <Button
                type="button"
                onClick={handleUpload}
                disabled={!canUpload}
              >
                {submitting ? "업로드 중..." : "확정 업로드"}
              </Button>
            </>
          )}

          {step === "done" && (
            <Button
              type="button"
              variant="outline"
              onClick={resetFileOnly}
              disabled={submitting}
            >
              새 업로드
            </Button>
          )}
        </div>
      </div>

      {/* ✅ 상세 모달 */}
      {result && (
        <CsvUploadDetailModal
          isOpen={showDetail}
          onClose={() => setShowDetail(false)}
          uploadId={result.upload_id}
        />
      )}
    </div>
  );
}
