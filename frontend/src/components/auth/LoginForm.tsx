"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { apiPost, setAccessToken } from "@/lib/api";

type LoginResponse =
  | { access_token: string; token_type?: string }
  | { token: string }
  | { accessToken: string };

export const LoginForm = () => {
  const router = useRouter();

  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      setSubmitting(true);

      const res = await apiPost<LoginResponse>("/auth/login", {
        email,
        password,
      });

      // 백엔드 구현에 따라 키 이름이 다를 수 있어서 넓게 대응
      const token =
        (res as any).access_token ?? (res as any).token ?? (res as any).accessToken;

      if (!token) {
        throw new Error("로그인 응답에 토큰이 없습니다. (/auth/login 응답 확인 필요)");
      }

      setAccessToken(token);

      // 로그인 성공 → 대시보드 이동
      router.push("/dashboard");
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "로그인 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          type="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full pl-11 pr-4 py-3 rounded-xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground input-focus-ring outline-none"
          required
        />
      </div>

      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          type={showPassword ? "text" : "password"}
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full pl-11 pr-11 py-3 rounded-xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground input-focus-ring outline-none"
          required
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 rounded-xl auth-gradient text-primary-foreground font-semibold tracking-wide transition-all duration-300 hover:opacity-90 hover:shadow-lg disabled:opacity-60"
      >
        {submitting ? "로그인 중..." : "로그인"}
      </button>
    </form>
  );
};