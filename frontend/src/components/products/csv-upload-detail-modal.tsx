"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import type { CsvUploadDetailOut, CsvUploadItemOut } from "@/lib/types";

export function CsvUploadDetailModal({
  isOpen,
  onClose,
  uploadId,
}: {
  isOpen: boolean;
  onClose: () => void;
  uploadId: number | null;
}) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<CsvUploadDetailOut | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!isOpen || !uploadId) return;

    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await apiGet<CsvUploadDetailOut>(
          `/csv-uploads/${uploadId}?limit=200&offset=0`,
        );
        setDetail(res);
      } catch {
        setError("업로드 상세 조회 실패");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [isOpen, uploadId]);

  if (!isOpen || !uploadId) return null;

  const items: CsvUploadItemOut[] = detail?.items ?? [];
  const COLS = 9;

  return (
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute left-1/2 top-1/2 w-[860px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card border border-border shadow-lg">
        <div className="p-5 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              CSV 업로드 상세 #{uploadId}
            </h3>
            {detail && (
              <p className="text-sm text-muted-foreground mt-1">
                {detail.upload.file_name} · total {detail.upload.total_rows} /
                valid {detail.upload.valid_rows} / invalid{" "}
                {detail.upload.invalid_rows}
              </p>
            )}
          </div>

          {/* ✅ 기능 2) 이 업로드만 제품 목록 보기 */}
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={`/products?upload_id=${uploadId}`}>
                이 업로드만 제품 보기
              </Link>
            </Button>

            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>

        <div className="p-5">
          {loading && (
            <div className="text-sm text-muted-foreground">불러오는 중...</div>
          )}
          {error && <div className="text-sm text-red-500">{error}</div>}

          {!loading && !error && detail && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr className="text-left">
                      {/* ✅ 기능 1) name/category 표시 */}
                      <th className="px-3 py-2">제품명</th>
                      <th className="px-3 py-2">카테고리</th>

                      <th className="px-3 py-2">product_id</th>
                      <th className="px-3 py-2">before</th>
                      <th className="px-3 py-2">after</th>
                      <th className="px-3 py-2">delta</th>
                      <th className="px-3 py-2">issue</th>
                      <th className="px-3 py-2">msg</th>
                      <th className="px-3 py-2">time</th>
                    </tr>
                  </thead>

                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id} className="border-t border-border">
                        <td className="px-3 py-2">{it.product_name ?? "-"}</td>
                        <td className="px-3 py-2">
                          {it.product_category ?? "-"}
                        </td>

                        <td className="px-3 py-2">{it.product_id}</td>
                        <td className="px-3 py-2">{it.before_qty ?? "-"}</td>
                        <td className="px-3 py-2">{it.after_qty ?? "-"}</td>
                        <td className="px-3 py-2">{it.delta_qty ?? "-"}</td>
                        <td className="px-3 py-2">{it.issue_code}</td>
                        <td className="px-3 py-2">{it.issue_msg ?? ""}</td>
                        <td className="px-3 py-2">
                          {it.created_at
                            ? new Date(it.created_at).toLocaleString()
                            : ""}
                        </td>
                      </tr>
                    ))}

                    {items.length === 0 && (
                      <tr>
                        <td
                          className="px-3 py-4 text-muted-foreground"
                          colSpan={COLS}
                        >
                          항목이 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}