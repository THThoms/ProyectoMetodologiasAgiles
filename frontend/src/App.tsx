import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import NuevoTicket from "./pages/NuevoTicket";
import AdminCatalogo from "./pages/AdminCatalogo";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { getCurrentUser, landingRouteFor } from "./lib/auth";

function RootRedirect() {
  const user = getCurrentUser();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={landingRouteFor(user.role)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/tickets/nuevo"
        element={
          <ProtectedRoute>
            <NuevoTicket />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/catalogo"
        element={
          <ProtectedRoute roles={["admin"]}>
            <AdminCatalogo />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
