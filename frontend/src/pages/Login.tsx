import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api, extractApiError } from "../lib/api";
import { MicrosoftLogo } from "../components/MicrosoftLogo";
import { landingRouteFor, saveToken, decodeToken } from "../lib/auth";

interface AuthConfig {
  ssoConfigured: boolean;
  devLoginEnabled: boolean;
  allowedDomain: string;
  microsoftSimulateEnabled?: boolean;
}

// Traduce ?error=... del callback de Azure AD a mensajes legibles para el usuario.
function errorMessageFor(code: string | null, domain: string): string | null {
  if (!code) return null;
  switch (code) {
    case "domain_not_allowed":
      return `Acceso denegado: solo se aceptan cuentas del dominio @${domain}.`;
    case "missing_code":
      return "Microsoft no devolvió un código de autorización.";
    case "auth_failed":
      return "No fue posible completar la autenticación. Inténtalo de nuevo.";
    case "sso_not_configured":
      return "El SSO con Microsoft aún no está configurado en este entorno.";
    case "session_expired":
      return "Tu sesión expiró. Inicia sesión nuevamente.";
    default:
      return `Error de autenticación: ${code}`;
  }
}

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState<AuthConfig | null>(null);

  // Estado del login local (correo + contraseña)
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submittingLocal, setSubmittingLocal] = useState(false);

  // Estado del login Microsoft simulado
  const [msError, setMsError] = useState<string | null>(null);
  const [submittingMs, setSubmittingMs] = useState(false);

  const urlError = params.get("error");

  useEffect(() => {
    api
      .get<AuthConfig>("/api/auth/config")
      .then((r) => setConfig(r.data))
      .catch(() =>
        setConfig({
          ssoConfigured: false,
          devLoginEnabled: false,
          allowedDomain: "uta.edu.ec",
          microsoftSimulateEnabled: true,
        })
      );
  }, []);

  // -----------------------------------------------------------------
  // CASO 1: Login local con correo y contraseña
  // -----------------------------------------------------------------
  async function handleLocalLogin(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmittingLocal(true);
    try {
      const { data } = await api.post<{ token: string; authProvider: string }>(
        "/api/auth/login",
        { correo: email, password }
      );
      saveToken(data.token, "local");
      const user = decodeToken(data.token);
      navigate(user ? landingRouteFor(user.role) : "/tickets/nuevo", {
        replace: true,
      });
    } catch (err) {
      setLocalError(extractApiError(err));
    } finally {
      setSubmittingLocal(false);
    }
  }

  // -----------------------------------------------------------------
  // CASO 2: Login simulado con Microsoft Office 365
  // -----------------------------------------------------------------
  async function handleMicrosoftSimulatedLogin() {
    setMsError(null);
    setSubmittingMs(true);
    try {
      const { data } = await api.post<{ token: string; authProvider: string }>(
        "/api/auth/microsoft-simulate",
        { email: email || "docente@uta.edu.ec" }
      );
      saveToken(data.token, "microsoft-simulated");
      const user = decodeToken(data.token);
      navigate(user ? landingRouteFor(user.role) : "/tickets/nuevo", {
        replace: true,
      });
    } catch (err) {
      setMsError(extractApiError(err));
    } finally {
      setSubmittingMs(false);
    }
  }

  const domain = config?.allowedDomain ?? "uta.edu.ec";
  const errorMsg = errorMessageFor(urlError, domain);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header institucional */}
      <header className="bg-uta-900 text-white shadow">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-white font-bold text-uta-900">
              UTA
            </div>
            <div>
              <div className="text-lg font-bold tracking-wide">SERVICEDESK UTA</div>
              <div className="text-xs text-uta-100/80">
                FISEI · Facultad de Ingeniería en Sistemas
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center bg-uta-50 px-4 py-10">
        <div className="w-full max-w-md">
          <div className="card">
            <h1 className="mb-1 text-center text-2xl font-bold text-uta-900">
              Bienvenido al ServiceDesk
            </h1>
            <p className="mb-6 text-center text-sm text-gray-600">
              Universidad Técnica de Ambato
            </p>

            {/* Error del callback de Azure AD */}
            {errorMsg && (
              <div className="mb-4 rounded-md border border-uta-300 bg-uta-100 px-4 py-3 text-sm text-uta-900">
                {errorMsg}
              </div>
            )}

            {/* ============================================================ */}
            {/* FORMULARIO: Login local con correo y contraseña              */}
            {/* ============================================================ */}
            <form onSubmit={handleLocalLogin} className="space-y-4">
              <div>
                <label className="label" htmlFor="login-email">
                  Correo electrónico
                </label>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  placeholder={`usuario@${domain}`}
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="label" htmlFor="login-password">
                  Contraseña
                </label>
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </div>

              {localError && (
                <p className="text-sm font-medium text-red-600">{localError}</p>
              )}

              <button
                type="submit"
                disabled={submittingLocal}
                className="btn-primary w-full"
              >
                {submittingLocal ? "Iniciando sesión..." : "Iniciar sesión"}
              </button>
            </form>

            {/* Enlace olvidaste contraseña */}
            <p className="mt-3 text-center text-xs text-gray-500">
              <a href="#" className="text-uta-700 hover:underline">
                ¿Olvidaste tu contraseña?
              </a>
            </p>

            {/* ============================================================ */}
            {/* BOTÓN: Microsoft Office 365 (simulado)                       */}
            {/* ============================================================ */}
            <div className="mt-5">
              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-3 text-gray-400">o continúa con</span>
                </div>
              </div>

              {msError && (
                <p className="mb-2 text-sm font-medium text-red-600">{msError}</p>
              )}

              <button
                type="button"
                onClick={handleMicrosoftSimulatedLogin}
                disabled={submittingMs}
                className="btn-ms365 w-full"
              >
                <MicrosoftLogo size={20} />
                <span>
                  {submittingMs ? "Conectando..." : "Microsoft Office 365"}
                </span>
              </button>

              <p className="mt-3 text-center text-xs text-gray-500">
                Solo se aceptan cuentas del dominio{" "}
                <strong>@{domain}</strong>
              </p>
            </div>

            {/* ============================================================ */}
            {/* BLOQUE DEV-LOGIN (solo si está habilitado en backend)        */}
            {/* ============================================================ */}
            {config?.devLoginEnabled && (
              <div className="mt-6 border-t border-uta-100 pt-4">
                <details className="text-xs text-gray-500">
                  <summary className="cursor-pointer font-semibold uppercase tracking-wide text-uta-700">
                    Modo desarrollo (dev-login)
                  </summary>
                  <p className="mt-2 mb-1 text-gray-600">
                    Usuarios de prueba: admin@uta.edu.ec (admin123),
                    docente@uta.edu.ec (docente123), tecn1@uta.edu.ec (tecn1123).
                  </p>
                </details>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="bg-uta-900 py-4 text-center text-xs text-white/70">
        Universidad Técnica de Ambato · FISEI · ServiceDesk Institucional
      </footer>
    </div>
  );
}
