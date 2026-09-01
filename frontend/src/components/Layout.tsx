import { ReactNode } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { clearToken, getCurrentUser, isStaffRole } from "../lib/auth";
import { getAccountNameLabel } from "../lib/technician";

interface LayoutProps {
  children: ReactNode;
  /** Mostrar el subnav (oculto en /login) */
  showSubnav?: boolean;
}

function getRoleLabel(role: string): string {
  if (role === "admin") return "Administrador";
  if (role.startsWith("tech_")) return "Técnico";
  return "Solicitante";
}

export function Layout({ children, showSubnav = true }: LayoutProps) {
  const user = getCurrentUser();
  const navigate = useNavigate();
  const location = useLocation();

  async function logout() {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // ignoramos errores: localmente limpiamos igualmente
    }
    clearToken();
    navigate("/login");
  }

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Barra superior - rojo oscuro institucional */}
      <header className="bg-uta-900 text-white shadow">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded bg-white font-bold text-uta-900">
              UTA
            </div>
            <span className="text-lg font-bold tracking-wide">SERVICEDESK UTA</span>
          </Link>

          {user && (
            <div className="flex items-center gap-4">
              <div className="text-right text-sm">
                <div className="font-semibold">{getAccountNameLabel(user)}</div>
                <div className="text-uta-100/80 text-xs">
                  {user.email} · <span>{getRoleLabel(user.role)}</span>
                </div>
              </div>
              <button
                onClick={logout}
                className="rounded border border-white/30 px-3 py-1.5 text-sm font-medium hover:bg-white/10"
              >
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Subnav - rojo medio */}
      {showSubnav && user && (
        <nav className="bg-uta-700 text-white">
          <div className="mx-auto flex max-w-7xl gap-1 px-6">
            <Link
              to="/tickets/nuevo"
              className={`px-4 py-2.5 text-sm font-medium transition ${
                isActive("/tickets/nuevo")
                  ? "bg-uta-900"
                  : "hover:bg-uta-900/60"
              }`}
            >
              Crear ticket
            </Link>
            <Link
              to="/mis-tickets"
              className={`px-4 py-2.5 text-sm font-medium transition ${
                isActive("/mis-tickets")
                  ? "bg-uta-900"
                  : "hover:bg-uta-900/60"
              }`}
            >
              Mis Tickets
            </Link>
            {isStaffRole(user.role) && (
              <Link
                to="/panel"
                className={`px-4 py-2.5 text-sm font-medium transition ${
                  isActive("/panel")
                    ? "bg-uta-900"
                    : "hover:bg-uta-900/60"
                }`}
              >
                Panel Técnico
              </Link>
            )}
            {isStaffRole(user.role) && (
              <Link
                to="/mis-aceptados"
                className={`px-4 py-2.5 text-sm font-medium transition ${
                  isActive("/mis-aceptados")
                    ? "bg-uta-900"
                    : "hover:bg-uta-900/60"
                }`}
              >
                Mis Aceptados
              </Link>
            )}
            {isStaffRole(user.role) && (
              <Link
                to="/conocimiento"
                className={`px-4 py-2.5 text-sm font-medium transition ${
                  isActive("/conocimiento")
                    ? "bg-uta-900"
                    : "hover:bg-uta-900/60"
                }`}
              >
                Conocimiento
              </Link>
            )}
            {user.role === "admin" && (
              <Link
                to="/admin/stats"
                className={`px-4 py-2.5 text-sm font-medium transition ${
                  isActive("/admin/stats")
                    ? "bg-uta-900"
                    : "hover:bg-uta-900/60"
                }`}
              >
                Estadísticas
              </Link>
            )}
            {user.role === "admin" && (
              <Link
                to="/admin/historial"
                className={`px-4 py-2.5 text-sm font-medium transition ${
                  isActive("/admin/historial")
                    ? "bg-uta-900"
                    : "hover:bg-uta-900/60"
                }`}
              >
                Historial
              </Link>
            )}
            {user.role === "admin" && (
              <Link
                to="/admin/reportes"
                className={`px-4 py-2.5 text-sm font-medium transition ${
                  isActive("/admin/reportes")
                    ? "bg-uta-900"
                    : "hover:bg-uta-900/60"
                }`}
              >
                Reportes
              </Link>
            )}
            {user.role === "admin" && (
              <Link
                to="/admin/catalogo"
                className={`px-4 py-2.5 text-sm font-medium transition ${
                  isActive("/admin/catalogo")
                    ? "bg-uta-900"
                    : "hover:bg-uta-900/60"
                }`}
              >
                Catálogo
              </Link>
            )}
          </div>
        </nav>
      )}

      {/* Contenido */}
      <main className="flex-1 bg-uta-50">
        <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
      </main>

      {/* Footer institucional */}
      <footer className="bg-uta-900 py-4 text-center text-xs text-white/70">
        Universidad Técnica de Ambato · FISEI · ServiceDesk Institucional
      </footer>
    </div>
  );
}
