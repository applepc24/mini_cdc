"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  useCallback,
} from "react";
import type { Settings } from "@/lib/types";

interface SettingsContextType {
  settings: Settings;
  updateSettings: (newSettings: Partial<Settings>) => void;
}

const defaultSettings: Settings = {
  threshold: 10,
  itemsPerPage: 20,
  theme: "system",
};

const STORAGE_KEY = "stockpulse-settings";

function loadSettings(): Settings {
  // ✅ SSR/빌드 시 안전
  if (typeof window === "undefined") return defaultSettings;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return defaultSettings;

  try {
    const parsed = JSON.parse(stored) as Partial<Settings>;
    return { ...defaultSettings, ...parsed };
  } catch {
    return defaultSettings;
  }
}

const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined
);

export function SettingsProvider({ children }: { children: ReactNode }) {
  // ✅ useEffect에서 setState 하지 말고, 초기화 단계에서 한 번에 로드
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };

      // ✅ 저장도 여기서 같이
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }

      return updated;
    });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}