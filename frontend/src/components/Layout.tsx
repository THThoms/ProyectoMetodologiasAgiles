import { ReactNode } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { clearToken, getCurrentUser } from "../lib/auth";

interface LayoutProps {
  children: ReactNode;
  /** Mostrar el subnav (oculto en /login) */
  showSubnav?: boolean;
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
                <div className="font-semibold">{user.name}</div>
                <div className="text-uta-100/80 text-xs">
                  {user.email} · <span className="uppercase">{user.role}</span>
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
                isActive("/tickets")
                  ? "bg-uta-900"
                  : "hover:bg-uta-900/60"
              }`}
            >
              Crear ticket
            </Link>
            {user.role === "admin" && (
              <Link
                to="/admin/catalogo"
                className={`px-4 py-2.5 text-sm font-medium transition ${
                  isActive("/admin")
                    ? "bg-uta-900"
                    : "hover:bg-uta-900/60"
                }`}
              >
                Admin · Catálogo
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
