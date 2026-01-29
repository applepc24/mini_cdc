import { apiGet, apiPost, setAccessToken, clearAccessToken } from "./api";

export type LoginRequest = { email: string; password: string };
export type LoginResponse = { accessToken: string; tokenType: "bearer" | string };

export type RegisterRequest = { email: string; password: string; name?: string | null };
export type RegisterResponse = { id: number; email: string; name?: string | null };

export type MeResponse = { id: number; email: string; name?: string | null };

export async function register(payload: RegisterRequest) {
  return apiPost<RegisterResponse>("/auth/register", payload);
}

export async function login(payload: LoginRequest) {
  const res = await apiPost<LoginResponse>("/auth/login", payload);
  setAccessToken(res.accessToken);
  return res;
}

export async function logout() {
  clearAccessToken();
}

export async function me() {
  return apiGet<MeResponse>("/auth/me");
}