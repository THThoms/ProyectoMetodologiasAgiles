import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import NuevoTicket from "./pages/NuevoTicket";
import AdminCatalogo from "./pages/AdminCatalogo";
import PanelTecnicoV2 from "./pages/PanelTecnicoV2";
import BaseConocimiento from "./pages/BaseConocimiento";
import MisTickets from "./pages/MisTickets";
import MisTicketsAceptados from "./pages/MisTicketsAceptados";
import AdminStats from "./pages/AdminStats";
import AdminHistorial from "./pages/AdminHistorial";
import AdminReporteTecnicos from "./pages/AdminReporteTecnicos";
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
      <Route path="/auth/success" element={<AuthCallback />} />
      <Route
        path="/tickets/nuevo"
        element={
          <ProtectedRoute>
            <NuevoTicket />
          </ProtectedRoute>
        }
      />
      <Route
        path="/panel"
        element={
          <ProtectedRoute roles={["admin", "tech_n1", "tech_n2", "tech_n3", "tech_n4"]}>
            <PanelTecnicoV2 />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mis-tickets"
        element={
          <ProtectedRoute>
            <MisTickets />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mis-aceptados"
        element={
          <ProtectedRoute roles={["admin", "tech_n1", "tech_n2", "tech_n3", "tech_n4"]}>
            <MisTicketsAceptados />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/stats"
        element={
          <ProtectedRoute roles={["admin"]}>
            <AdminStats />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/historial"
        element={
          <ProtectedRoute roles={["admin"]}>
            <AdminHistorial />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/reportes"
        element={
          <ProtectedRoute roles={["admin"]}>
            <AdminReporteTecnicos />
          </ProtectedRoute>
        }
      />
      <Route
        path="/conocimiento"
        element={
          <ProtectedRoute roles={["admin", "tech_n1", "tech_n2", "tech_n3", "tech_n4"]}>
            <BaseConocimiento />
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
