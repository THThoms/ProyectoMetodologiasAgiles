import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api, extractApiError } from "../lib/api";
import { MicrosoftLogo } from "../components/MicrosoftLogo";
import { landingRouteFor, saveToken, decodeToken } from "../lib/auth";

interface AuthConfig {
  ssoConfigured: boolean;
  devLoginEnabled: boolean;
  allowedDomain: string;
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
  const [devEmail, setDevEmail] = useState("admin@uta.edu.ec");
  const [devError, setDevError] = useState<string | null>(null);
  const [submittingDev, setSubmittingDev] = useState(false);

  const urlError = params.get("error");

  useEffect(() => {
    api
      .get<AuthConfig>("/api/auth/config")
      .then((r) => setConfig(r.data))
      .catch(() => setConfig({ ssoConfigured: false, devLoginEnabled: false, allowedDomain: "uta.edu.ec" }));
  }, []);

  function loginMicrosoft() {
    // No usamos axios porque el endpoint hace redirect 302 hacia login.microsoftonline.com
    window.location.href = `${
      (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080"
    }/api/auth/microsoft`;
  }

  async function loginDev(e: React.FormEvent) {
    e.preventDefault();
    setDevError(null);
    setSubmittingDev(true);
    try {
      const { data } = await api.post<{ token: string }>("/api/auth/dev-login", {
        email: devEmail,
      });
      saveToken(data.token);
      const user = decodeToken(data.token);
      navigate(user ? landingRouteFor(user.role) : "/tickets/nuevo", { replace: true });
    } catch (err) {
      setDevError(extractApiError(err));
    } finally {
      setSubmittingDev(false);
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
              <div className="text-xs text-uta-100/80">FISEI · Facultad de Ingeniería en Sistemas</div>
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
              <div className="mb-4 rounded-md border border-uta-300 bg-uta-100 px-4 py-3 text-sm text-uta-900">
                {errorMsg}
              </div>
            )}

            {/* Botón Microsoft (oficial) */}
            <button
              onClick={loginMicrosoft}
              disabled={!config?.ssoConfigured}
              className="btn-microsoft w-full"
              title={
                config?.ssoConfigured
                  ? "Iniciar sesión con Microsoft"
                  : "El SSO con Microsoft aún no está configurado"
              }
            >
              <MicrosoftLogo size={20} />
              <span>Iniciar sesión con Microsoft</span>
            </button>
            <p className="mt-3 text-center text-xs text-gray-500">
              Solo se aceptan cuentas del dominio <strong>@{domain}</strong>
            </p>

            {/* Bloque dev-login (solo si está habilitado en backend) */}
            {config?.devLoginEnabled && (
              <div className="mt-8 border-t border-uta-100 pt-6">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-uta-700">
                  Modo desarrollo
                </p>
                <p className="mb-3 text-xs text-gray-600">
                  Mientras Azure AD se configura, puedes entrar con un usuario sembrado
                  (admin@uta.edu.ec, tecn1@uta.edu.ec, docente@uta.edu.ec, etc.).
                </p>
                <form onSubmit={loginDev} className="space-y-3">
                  <div>
                    <label className="label" htmlFor="dev-email">
                      Email institucional
                    </label>
                    <input
                      id="dev-email"
                      type="email"
                      value={devEmail}
                      onChange={(e) => setDevEmail(e.target.value)}
                      className="input"
                      placeholder={`usuario@${domain}`}
                      required
                    />
                  </div>
                  {devError && (
                    <p className="text-sm font-medium text-uta-700">{devError}</p>
                  )}
                  <button type="submit" disabled={submittingDev} className="btn-secondary w-full">
                    {submittingDev ? "Entrando..." : "Entrar (dev-login)"}
                  </button>
                </form>
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
