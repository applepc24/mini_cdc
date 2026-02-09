"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Save, Moon, Sun, Monitor } from "lucide-react";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/hooks/use-settings";
import { useTheme } from "@/hooks/use-theme";
import { useAppToast } from "@/hooks/use-app-toast";
import { cn } from "@/lib/utils";
import { SlackSettingsCard } from "@/components/settings/SlackSettingsCard";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

type DraftSettings = {
  threshold: number;
  itemsPerPage: number;
};

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { theme, setTheme } = useTheme();
  const { addToast } = useAppToast();

  // ✅ hydration mismatch 방지: mounted 이후에만 theme 기반 UI를 확정
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  // ✅ settings를 "복사"하지 않고, 사용자 입력이 생길 때만 draft를 만든다
  const [draft, setDraft] = useState<DraftSettings | null>(null);

  // 화면에 보여줄 값: draft가 있으면 draft, 없으면 서버/스토어 settings
  const view = useMemo(
    () => ({
      threshold: draft?.threshold ?? settings.threshold,
      itemsPerPage: draft?.itemsPerPage ?? settings.itemsPerPage,
    }),
    [draft, settings.threshold, settings.itemsPerPage],
  );

  const hasChanges =
    view.threshold !== settings.threshold ||
    view.itemsPerPage !== settings.itemsPerPage;

  const handleSave = () => {
    updateSettings(view);
    setDraft(null);
    addToast("success", "설정이 저장되었습니다");
  };

  const handleReset = () => {
    setDraft(null);
  };

  const themeOptions = [
    { value: "light", label: "라이트", icon: Sun },
    { value: "dark", label: "다크", icon: Moon },
    { value: "system", label: "시스템", icon: Monitor },
  ] as const;

  const itemsPerPageOptions = [10, 20, 50, 100];

  return (
    <AppLayout>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-2xl space-y-6"
      >
        <motion.div variants={itemVariants}>
          <h1 className="text-2xl font-semibold text-foreground">설정</h1>
          <p className="text-muted-foreground">
            StockPulse 환경을 맞춤 설정하세요
          </p>
        </motion.div>

        {/* Appearance */}
        <motion.div
          variants={itemVariants}
          className="bg-card rounded-xl border border-border p-6"
        >
          <h2 className="text-lg font-semibold text-foreground mb-4">외관</h2>

          <div className="space-y-4">
            <div>
              <Label className="mb-3 block">테마</Label>

              {/* ✅ mounted 전엔 SSR/CSR mismatch 유발 가능 → placeholder */}
              {!mounted ? (
                <div className="grid grid-cols-3 gap-3">
                  {themeOptions.map((option) => (
                    <div
                      key={option.value}
                      className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-border opacity-60"
                    >
                      <option.icon className="w-6 h-6 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        {option.label}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {themeOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setTheme(option.value)}
                      className={cn(
                        "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all",
                        theme === option.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/50",
                      )}
                    >
                      <option.icon
                        className={cn(
                          "w-6 h-6",
                          theme === option.value
                            ? "text-primary"
                            : "text-muted-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          "text-sm font-medium",
                          theme === option.value
                            ? "text-primary"
                            : "text-foreground",
                        )}
                      >
                        {option.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Inventory Settings */}
        <motion.div
          variants={itemVariants}
          className="bg-card rounded-xl border border-border p-6"
        >
          <h2 className="text-lg font-semibold text-foreground mb-4">재고</h2>

          <div className="space-y-6">
            <div>
              <Label htmlFor="threshold" className="mb-2 block">
                기본 재고 임계값
              </Label>
              <p className="text-sm text-muted-foreground mb-3">
                이 수량 이하의 재고를 가진 제품에 알림이 표시됩니다
              </p>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={view.threshold}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setDraft((prev) => ({
                      threshold: v,
                      itemsPerPage: prev?.itemsPerPage ?? settings.itemsPerPage,
                    }));
                  }}
                  className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <Input
                  id="threshold"
                  type="number"
                  min="1"
                  max="100"
                  value={view.threshold}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setDraft((prev) => ({
                      threshold: v,
                      itemsPerPage: prev?.itemsPerPage ?? settings.itemsPerPage,
                    }));
                  }}
                  className="w-20"
                />
              </div>
            </div>

            <div>
              <Label className="mb-2 block">페이지당 항목 수</Label>
              <p className="text-sm text-muted-foreground mb-3">
                목록에서 페이지당 표시할 제품 수
              </p>
              <div className="flex gap-2">
                {itemsPerPageOptions.map((option) => (
                  <button
                    key={option}
                    onClick={() => {
                      setDraft((prev) => ({
                        threshold: prev?.threshold ?? settings.threshold,
                        itemsPerPage: option,
                      }));
                    }}
                    className={cn(
                      "px-4 py-2 rounded-lg border transition-all",
                      view.itemsPerPage === option
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-muted-foreground/50 text-foreground",
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Slack Settings */}
        <SlackSettingsCard itemVariants={itemVariants} />

        {/* Keyboard Shortcuts */}
        <motion.div
          variants={itemVariants}
          className="bg-card rounded-xl border border-border p-6"
        >
          <h2 className="text-lg font-semibold text-foreground mb-4">
            키보드 단축키
          </h2>

          <div className="space-y-3">
            {[
              {
                keys: ["/", "or", "Ctrl", "K"],
                description: "검색 / 명령 팔레트 열기",
              },
              { keys: ["N"], description: "새 제품 (제품 페이지에서)" },
              { keys: ["Esc"], description: "모달 또는 드롭다운 닫기" },
              { keys: ["G", "D"], description: "대시보드로 이동" },
              { keys: ["G", "P"], description: "제품으로 이동" },
              { keys: ["G", "A"], description: "알림으로 이동" },
              { keys: ["G", "S"], description: "설정으로 이동" },
            ].map((shortcut, index) => (
              <div
                key={index}
                className="flex items-center justify-between py-2"
              >
                <span className="text-muted-foreground">
                  {shortcut.description}
                </span>
                <div className="flex items-center gap-1">
                  {shortcut.keys.map((key, i) =>
                    key === "or" ? (
                      <span
                        key={i}
                        className="text-xs text-muted-foreground mx-1"
                      >
                        or
                      </span>
                    ) : (
                      <kbd
                        key={i}
                        className="px-2 py-1 text-xs font-mono bg-muted text-muted-foreground rounded border border-border"
                      >
                        {key}
                      </kbd>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Save Button */}
        <motion.div variants={itemVariants} className="flex justify-end gap-2">
          <Button onClick={handleSave} disabled={!hasChanges}>
            <Save className="w-4 h-4 mr-2" />
            변경사항 저장
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleReset}
            disabled={!hasChanges}
          >
            되돌리기
          </Button>
        </motion.div>
      </motion.div>
    </AppLayout>
  );
}
