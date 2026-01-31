"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  resolvedTheme: "light" | "dark";
};

const STORAGE_KEY = "stockpulse-theme";

function getInitialTheme(): Theme {
  // ✅ setState-in-effect 룰 피하려고, 초기값은 useState initializer에서 결정
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

function getSystemResolvedTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme());

  // ✅ system 테마 변화는 "이벤트 콜백"에서 state 변경 (effect 본문에서 직접 setState X)
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() =>
    getSystemResolvedTheme(),
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const onChange = () => {
      // ✅ 콜백에서 setState -> lint 룰 통과하는 패턴
      setSystemTheme(mq.matches ? "dark" : "light");
    };

    // 초기 한번 동기화는 setState-in-effect 룰에 걸릴 수 있으니,
    // 초기값은 useState initializer에서 이미 맞춰둠.
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const resolvedTheme: "light" | "dark" = theme === "system" ? systemTheme : theme;

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // ignore
    }
  }, []);

  // ✅ 실제 DOM(html class)에 반영은 "side-effect"만 수행 (setState 없음)
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [resolvedTheme]);

  const value = useMemo(
    () => ({ theme, setTheme, resolvedTheme }),
    [theme, setTheme, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}