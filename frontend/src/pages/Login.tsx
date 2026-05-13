import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, extractApiError } from "../lib/api";
import { MicrosoftLogo } from "../components/MicrosoftLogo";
import { decodeToken, landingRouteFor, saveToken } from "../lib/auth";

interface AuthConfig {
  ssoConfigured: boolean;
  devLoginEnabled: boolean;
  allowedDomain: string;
  microsoftSimulateEnabled?: boolean;
}

function errorMessageFor(code: string | null, domain: string): string | null {
  if (!code) return null;
  switch (code) {
    case "domain_not_allowed":
      return `Acceso denegado: solo se aceptan cuentas del dominio @${domain}.`;
    case "missing_code":
    case "missing_token":
      return "Microsoft no devolvió la información necesaria.";
    case "auth_failed":
      return "No fue posible completar la autenticación. Inténtalo de nuevo.";
    case "sso_not_configured":
      return "El SSO con Microsoft aún no está configurado en este entorno. Revisa las variables MICROSOFT_* en .env.";
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msLoading, setMsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const domain = config?.allowedDomain ?? "uta.edu.ec";
  const ssoReady = Boolean(config?.ssoConfigured);
  const msSimulateReady = Boolean(config?.microsoftSimulateEnabled);
  const errorMsg = error ?? errorMessageFor(urlError, domain);

  // -----------------------------------------------------------------------
  // Login local con correo + contraseña
  // -----------------------------------------------------------------------
  async function handleLocalLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Ingresa tu correo y contraseña.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await api.post("/api/auth/login", {
        correo: email.trim(),
        password: password.trim(),
      });
      const { token, authProvider } = res.data;
      saveToken(token, authProvider ?? "local");
      const user = decodeToken(token);
      navigate(user ? landingRouteFor(user.role) : "/", { replace: true });
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------------------------------------------------
  // Login Microsoft — SSO real (redirect full-page) o simulado (API call)
  // -----------------------------------------------------------------------
  async function handleMicrosoftLogin() {
    setError(null);
    setMsLoading(true);

    // Si el SSO real está configurado, redirigimos al flujo de Azure AD
    if (ssoReady) {
      const apiBase =
        (import.meta.env.VITE_API_URL as string | undefined) ??
        "http://localhost:8080";

      const hint = email.trim();
      const qs = hint ? `?login_hint=${encodeURIComponent(hint)}` : "";
      // Full-page redirect: Microsoft envía COOP=same-origin que corta
      // window.opener, así que el patrón popup+postMessage no funciona.
      // El callback regresa a /auth/success?token=... que AuthCallback maneja.
      window.location.href = `${apiBase}/api/auth/microsoft${qs}`;
      return;
    }

    // Fallback: Login simulado Microsoft (cuando SSO real no está configurado)
    if (msSimulateReady) {
      try {
        const res = await api.post("/api/auth/microsoft-simulate", {
          email: email.trim() || "docente@uta.edu.ec",
        });
        const { token, authProvider } = res.data;
        saveToken(token, authProvider ?? "microsoft-simulated");
        const user = decodeToken(token);
        navigate(user ? landingRouteFor(user.role) : "/", { replace: true });
      } catch (err) {
        setError(extractApiError(err));
      } finally {
        setMsLoading(false);
      }
      return;
    }

    setError("El inicio de sesión con Microsoft no está disponible en este momento.");
    setMsLoading(false);
  }

  const anyLoading = loading || msLoading;

  return (
    <div className="flex min-h-screen flex-col">
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

            {errorMsg && (
              <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                {errorMsg}
              </div>
            )}

            {/* ---- Formulario de login local (correo + contraseña) ---- */}
            <form onSubmit={handleLocalLogin} className="space-y-4">
              <div>
                <label className="label" htmlFor="login-email">
                  Correo institucional
                </label>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  placeholder={`usuario@${domain}`}
                  autoComplete="email"
                  disabled={anyLoading}
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
                  autoComplete="current-password"
                  disabled={anyLoading}
                />
              </div>

              <button
                type="submit"
                disabled={anyLoading}
                className="btn-primary w-full"
              >
                {loading ? "Iniciando sesión…" : "Iniciar sesión"}
              </button>
            </form>

            {/* ---- Separador ---- */}
            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-300" />
              <span className="text-xs text-gray-400">o</span>
              <div className="h-px flex-1 bg-gray-300" />
            </div>

            {/* ---- Botón Microsoft ---- */}
            <button
              type="button"
              onClick={handleMicrosoftLogin}
              disabled={(!ssoReady && !msSimulateReady) || anyLoading}
              className="btn-ms365 w-full"
            >
              <MicrosoftLogo size={20} />
              <span>
                {msLoading
                  ? "Esperando autenticación…"
                  : "Iniciar sesión con Microsoft"}
              </span>
            </button>

            <p className="mt-4 text-center text-xs text-gray-500">
              Solo se aceptan cuentas del dominio <strong>@{domain}</strong>
            </p>
          </div>
        </div>
      </main>

      <footer className="bg-uta-900 py-4 text-center text-xs text-white/70">
        Universidad Técnica de Ambato · FISEI · ServiceDesk Institucional
      </footer>
    </div>
  );
}
