import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { decodeToken, landingRouteFor, saveToken } from "../lib/auth";

// Recibe el token en el query (después del callback de Microsoft + auth-service),
// lo guarda en localStorage y navega al dashboard según rol.
export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = params.get("token");
    const errorCode = params.get("error");

    if (!token) {
      navigate(`/login?error=${errorCode ?? "missing_code"}`, { replace: true });
      return;
    }
    const user = decodeToken(token);
    if (!user) {
      navigate("/login?error=auth_failed", { replace: true });
      return;
    }
    saveToken(token, "microsoft");
    navigate(landingRouteFor(user.role), { replace: true });
  }, [params, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-uta-50">
      <div className="card text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-100 border-t-uta-500" />
        <p className="text-sm text-uta-900">Procesando inicio de sesión…</p>
      </div>
    </div>
  );
}
