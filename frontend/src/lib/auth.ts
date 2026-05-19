import { jwtDecode } from "jwt-decode";

export type Role = "admin" | "tech_n1" | "tech_n2" | "tech_n3" | "tech_n4" | "user";
export type AuthProvider = "local" | "microsoft" | "microsoft-simulated";

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: Role;
  authProvider?: AuthProvider;
  exp?: number;
}

const TOKEN_KEY = "sd_token";
const AUTH_PROVIDER_KEY = "sd_auth_provider";

export function saveToken(token: string, authProvider?: AuthProvider): void {
  localStorage.setItem(TOKEN_KEY, token);
  if (authProvider) {
    localStorage.setItem(AUTH_PROVIDER_KEY, authProvider);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getAuthProvider(): AuthProvider | null {
  return localStorage.getItem(AUTH_PROVIDER_KEY) as AuthProvider | null;
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AUTH_PROVIDER_KEY);
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

// Verifica si hay una sesión activa (sin importar el authProvider)
export function isAuthenticated(): boolean {
  return getCurrentUser() !== null;
}

// Sprint 2 (rev): admin va a estadísticas, técnicos al panel con bandejas,
// usuarios normales a "Mis Tickets" (donde ven historial + crear).
export function landingRouteFor(role: Role): string {
  if (role === "admin") return "/admin/stats";
  if (role === "tech_n1" || role === "tech_n2" || role === "tech_n3" || role === "tech_n4") {
    return "/panel";
  }
  return "/mis-tickets";
}

// Devuelve el nivel técnico (N1..N4) del rol; null si no aplica.
export function levelOfRole(role: Role): "N1" | "N2" | "N3" | "N4" | null {
  switch (role) {
    case "tech_n1": return "N1";
    case "tech_n2": return "N2";
    case "tech_n3": return "N3";
    case "tech_n4": return "N4";
    default: return null;
  }
}

// True si el rol puede acceder al Panel Técnico (HU-07).
export function isStaffRole(role: Role): boolean {
  return role === "admin" || levelOfRole(role) !== null;
}
