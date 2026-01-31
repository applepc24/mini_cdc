"use client";

import { useState, type FormEvent } from "react";
import { Mail, Lock, User, Eye, EyeOff } from "lucide-react";
import { apiPost } from "@/lib/api";

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return "회원가입 실패";
}

export const RegisterForm = ({
  onRegistered,
}: {
  onRegistered?: () => void;
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [submitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      setIsSubmitting(true);

      await apiPost("/auth/register", {
        email,
        password,
        name, // ✅ 포함!
      });

      onRegistered?.(); // ✅ 성공하면 로그인 화면으로 전환
    } catch (err: unknown) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="relative">
        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          type="text"
          placeholder="이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full pl-11 pr-4 py-3 rounded-xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground input-focus-ring outline-none"
          required
        />
      </div>

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
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          {showPassword ? (
            <EyeOff className="w-5 h-5" />
          ) : (
            <Eye className="w-5 h-5" />
          )}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 rounded-xl auth-gradient text-primary-foreground font-semibold tracking-wide transition-all duration-300 hover:opacity-90 hover:shadow-lg disabled:opacity-60"
      >
        {submitting ? "가입 중..." : "회원가입"}
      </button>
    </form>
  );
};
