import { jwtDecode } from "jwt-decode";

export type Role = "admin" | "tech_n1" | "tech_n2" | "tech_n3" | "tech_n4" | "user";

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: Role;
  exp?: number;
}

const TOKEN_KEY = "sd_token";

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// Decodifica el JWT sin validar la firma (la valida el backend en cada request).
// Solo lo usamos para pintar el nombre/rol en la UI y elegir el dashboard inicial.
export function decodeToken(token: string): AuthUser | null {
  try {
    return jwtDecode<AuthUser>(token);
  } catch {
    return null;
  }
}

export function getCurrentUser(): AuthUser | null {
  const token = getToken();
  if (!token) return null;
  const user = decodeToken(token);
  if (!user) return null;
  // expirado -> limpiar
  if (user.exp && user.exp * 1000 < Date.now()) {
    clearToken();
    return null;
  }
  return user;
}

// Mapea rol -> ruta inicial. Para Sprint 1 todos van al formulario de ticket,
// excepto admin que entra al panel de catálogo.
export function landingRouteFor(role: Role): string {
  if (role === "admin") return "/admin/catalogo";
  return "/tickets/nuevo";
}
