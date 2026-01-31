"use client";

import * as React from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "stockpulse-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  return stored ?? "system";
}

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

export function useTheme() {
  // ✅ 초기값은 여기서 결정 (effect에서 setState 금지 룰 회피)
  const [theme, setTheme] = React.useState<Theme>(getInitialTheme);

  // ✅ effect는 외부 시스템 동기화만: DOM / localStorage
  React.useEffect(() => {
    const resolved = resolveTheme(theme);

    // localStorage 저장
    window.localStorage.setItem(STORAGE_KEY, theme);

    // HTML에 반영 (Tailwind dark 모드용)
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
  }, [theme]);

  // system 테마일 때 OS 테마 변경을 즉시 반영하고 싶다면 (선택)
  React.useEffect(() => {
    if (theme !== "system") return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved = resolveTheme("system");
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(resolved);
    };

    // 초기 1회 반영
    onChange();

    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);
  
  const resolvedTheme = React.useMemo(() => resolveTheme(theme), [theme]);

  return { theme, setTheme, resolvedTheme };
}
