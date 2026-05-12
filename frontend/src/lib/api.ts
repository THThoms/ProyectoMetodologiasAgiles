import axios, { AxiosError } from "axios";
import { clearToken, getToken } from "./auth";

// Todas las llamadas pasan por el API Gateway (regla del Sprint 1).
// El frontend nunca toca un microservicio directamente.
const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080";

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
});

// Inyecta JWT en cada request si existe.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// 401 => sesión expirada/revocada: limpia el JWT y manda al login.
api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      clearToken();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login?error=session_expired";
      }
    }
    return Promise.reject(err);
  }
);

// Helper para extraer el mensaje de error que devuelve el backend.
export function extractApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; detail?: string } | undefined;
    return data?.error ?? data?.detail ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return "Error desconocido";
}
