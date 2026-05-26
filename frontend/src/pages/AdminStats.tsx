// Sprint 2 (rev) - Dashboard de estadísticas del administrador.
// Visualización con gráficos SVG (donut, barras, línea) sin dependencias
// externas. La asignación manual ahora usa un dropdown poblado desde
// /api/admin/technicians (no se pide UUID al admin).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";
import DonutChart, { DonutSlice } from "../components/charts/DonutChart";
import BarChart from "../components/charts/BarChart";
import LineChart from "../components/charts/LineChart";
import { getTechnicianAreaLabel, getTechnicianDisplayLabel } from "../lib/technician";

interface StatsResponse {
  totals: {
    tickets: number;
    pending: number;
    inProgress: number;
    escalated: number;
    resolved: number;
    closed: number;
    accepted: number;
    available: number;
  };
  byService: Array<{ service: string; count: number }>;
  byResponsibleArea: Array<{ area: string; count: number }>;
  byPriority: Array<{ priority: string; count: number }>;
  byTechnician: Array<{ technicianId: string | null; technicianName: string; count: number }>;
  resolvedByTechnician?: Array<{
    technicianId: string | null;
    technicianName: string;
    count: number;
  }>;
  createdByDay?: Array<{ date: string; count: number }>;
  avgAcceptSeconds: number | null;
  avgResolveSeconds: number | null;
}

interface UnassignedTicket {
  id: string;
  number: string;
  userName: string | null;
  serviceName: string | null;
  responsibleArea: "TECHNICIANS" | "TICS" | "GENERAL";
  priority: string;
  status: string;
  assignedTechnicianId: string | null;
  assignedTechnicianName: string | null;
  createdAt: string;
}

interface Technician {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  areas: Array<"TECHNICIANS" | "TICS" | "GENERAL">;
}

function formatSecs(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} d`;
}

// Paletas: estados, prioridades, áreas. Pensadas para coincidir con los badges
// que usamos en otras vistas.
const STATUS_COLORS: Record<string, string> = {
  pending: "#3b82f6",
  inProgress: "#f59e0b",
  escalated: "#8b5cf6",
  resolved: "#10b981",
  closed: "#64748b",
};
const PRIORITY_COLORS: Record<string, string> = {
  baja: "#94a3b8",
  media: "#3b82f6",
  alta: "#f97316",
  critica: "#dc2626",
};
const AREA_COLORS: Record<string, string> = {
  TECHNICIANS: "#9c1f2c",
  TICS: "#0ea5e9",
  GENERAL: "#64748b",
};

export default function AdminStats() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [tickets, setTickets] = useState<UnassignedTicket[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<UnassignedTicket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, t, te] = await Promise.all([
        api.get<StatsResponse>("/api/admin/stats/tickets"),
        api.get<{ tickets: UnassignedTicket[]; areas: string[] }>("/api/tickets/available"),
        api.get<{ technicians: Technician[] }>("/api/admin/technicians"),
      ]);
      setStats(s.data);
      setTickets(t.data.tickets);
      setTechnicians(te.data.technicians);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // --- Series para gráficos -------------------------------------------------
  const statusDonut: DonutSlice[] = useMemo(() => {
    if (!stats) return [];
    const t = stats.totals;
    return [
      { label: "Pendientes", value: t.pending, color: STATUS_COLORS.pending },
      { label: "En proceso", value: t.inProgress, color: STATUS_COLORS.inProgress },
      { label: "Escalados", value: t.escalated, color: STATUS_COLORS.escalated },
      { label: "Resueltos", value: t.resolved, color: STATUS_COLORS.resolved },
      { label: "Cerrados", value: t.closed, color: STATUS_COLORS.closed },
    ].filter((s) => s.value > 0);
  }, [stats]);

  const priorityDonut: DonutSlice[] = useMemo(() => {
    if (!stats) return [];
    return stats.byPriority
      .map((p) => ({
        label: p.priority.charAt(0).toUpperCase() + p.priority.slice(1),
        value: p.count,
        color: PRIORITY_COLORS[p.priority] ?? "#94a3b8",
      }))
      .filter((p) => p.value > 0);
  }, [stats]);

  const areaBars = useMemo(() => {
    if (!stats) return [];
    return stats.byResponsibleArea.map((b) => ({
      label: b.area,
      value: b.count,
      color: AREA_COLORS[b.area] ?? "#9c1f2c",
    }));
  }, [stats]);

  const serviceBars = useMemo(() => {
    if (!stats) return [];
    return stats.byService.slice(0, 8).map((b) => ({ label: b.service, value: b.count }));
  }, [stats]);

  const techBars = useMemo(() => {
    if (!stats) return [];
    return stats.byTechnician
      .slice(0, 8)
      .map((b) => ({ label: b.technicianName, value: b.count }));
  }, [stats]);

  const resolvedBars = useMemo(() => {
    if (!stats?.resolvedByTechnician) return [];
    return stats.resolvedByTechnician
      .slice(0, 8)
      .map((b) => ({ label: b.technicianName, value: b.count, color: "#10b981" }));
  }, [stats]);

  return (
    <Layout>
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-uta-900">Estadísticas administrativas</h1>
            <p className="mt-1 text-sm text-gray-600">
              Visión general de tickets, áreas, prioridades y carga por técnico.
            </p>
          </div>
          <Link
            to="/admin/historial"
            className="rounded bg-uta-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-uta-800"
          >
            Ir al Historial General
          </Link>
        </div>

        {flash && (
          <div className="mb-4 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
            {flash}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600" />
            <p className="text-sm text-gray-500">Cargando estadísticas…</p>
          </div>
        )}

        {!loading && stats && (
          <>
            {/* KPIs */}
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Indicadores principales
            </h2>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <Kpi label="Total" value={stats.totals.tickets} accent="bg-uta-100 text-uta-900" />
              <Kpi label="Disponibles" value={stats.totals.available} accent="bg-blue-100 text-blue-800" />
              <Kpi label="Pendientes" value={stats.totals.pending} accent="bg-blue-50 text-blue-700" />
              <Kpi label="En proceso" value={stats.totals.inProgress} accent="bg-amber-100 text-amber-800" />
              <Kpi label="Aceptados" value={stats.totals.accepted} accent="bg-cyan-100 text-cyan-800" />
              <Kpi label="Escalados" value={stats.totals.escalated} accent="bg-purple-100 text-purple-800" />
              <Kpi label="Resueltos" value={stats.totals.resolved} accent="bg-emerald-100 text-emerald-800" />
              <Kpi label="Cerrados" value={stats.totals.closed} accent="bg-gray-200 text-gray-800" />
            </div>

            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TimeCard label="Tiempo promedio de aceptación" value={formatSecs(stats.avgAcceptSeconds)} />
              <TimeCard label="Tiempo promedio de resolución" value={formatSecs(stats.avgResolveSeconds)} />
            </div>

            {/* Gráficos */}
            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <DonutChart title="Tickets por estado" data={statusDonut} centerLabel="Tickets" />
              <DonutChart title="Tickets por prioridad" data={priorityDonut} centerLabel="Tickets" />
            </div>

            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <BarChart title="Tickets por área responsable" data={areaBars} variant="horizontal" />
              <BarChart title="Tickets por servicio (top 8)" data={serviceBars} variant="horizontal" />
            </div>

            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <BarChart
                title="Carga por técnico (top 8 asignados)"
                data={techBars}
                variant="horizontal"
                defaultColor="#0ea5e9"
              />
              <BarChart
                title="Resueltos por técnico (top 8)"
                data={resolvedBars}
                variant="horizontal"
                defaultColor="#10b981"
              />
            </div>

            <div className="mb-6">
              <LineChart
                title="Tickets creados — últimos 30 días"
                data={(stats.createdByDay ?? []).map((p) => ({
                  date: p.date,
                  value: p.count,
                }))}
              />
            </div>
          </>
        )}

        {/* Tickets sin asignar */}
        <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Tickets sin asignar
        </h2>
        {tickets.length === 0 ? (
          <p className="card py-4 text-center text-sm text-gray-500">
            Ningún ticket pendiente de asignación.
          </p>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Ticket</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Solicitante</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Servicio</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Área</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Prioridad</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-uta-900">{t.number}</td>
                    <td className="px-4 py-3 text-gray-700">{t.userName ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{t.serviceName ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex rounded bg-uta-50 px-2 py-0.5 text-xs font-bold text-uta-900">
                        {t.responsibleArea}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{t.priority}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setAssigning(t)}
                        className="rounded bg-uta-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-uta-800"
                      >
                        Asignar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {assigning && (
          <AssignModal
            ticket={assigning}
            technicians={technicians}
            onClose={() => setAssigning(null)}
            onSuccess={() => {
              setAssigning(null);
              setFlash("Ticket asignado correctamente");
              load();
              window.setTimeout(() => setFlash(null), 5000);
            }}
          />
        )}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Pequeñas tarjetas KPI con acento de color por categoría.
// ---------------------------------------------------------------------------
function Kpi({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="card flex flex-col items-center justify-center text-center">
      <span className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${accent}`}>
        {label}
      </span>
      <p className="text-2xl font-extrabold text-gray-900">{value}</p>
    </div>
  );
}

function TimeCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card flex items-center justify-between">
      <span className="text-sm font-semibold text-gray-600">{label}</span>
      <span className="text-xl font-bold text-uta-900">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssignModal: ya no pide UUID. Muestra un <select> con técnicos filtrados por
// el área del ticket, con búsqueda por nombre/email.
// ---------------------------------------------------------------------------
function AssignModal({
  ticket,
  technicians,
  onClose,
  onSuccess,
}: {
  ticket: UnassignedTicket;
  technicians: Technician[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [technicianId, setTechnicianId] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligible = useMemo(() => {
    const list = technicians.filter((t) => t.areas.includes(ticket.responsibleArea));
    const q = search.trim().toLowerCase();
    if (!q) return list;
    // Buscamos por email y por área visible (no por el rol interno ni por el
    // nombre crudo del seed, para que coincida con lo que el admin ve).
    return list.filter(
      (t) =>
        t.email.toLowerCase().includes(q) ||
        getTechnicianAreaLabel(t).toLowerCase().includes(q)
    );
  }, [technicians, ticket.responsibleArea, search]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!technicianId) {
      setError("Selecciona un técnico.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/api/admin/tickets/${ticket.id}/assign`, {
        technicianId,
        note: note.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <form onSubmit={submit}>
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-bold text-uta-900">Asignar ticket manualmente</h2>
            <p className="mt-1 text-sm text-gray-600">
              <span className="font-mono font-semibold">{ticket.number}</span> · área{" "}
              {ticket.responsibleArea}
            </p>
          </div>
          <div className="space-y-3 px-6 py-5">
            <div>
              <label className="label">Buscar técnico</label>
              <input
                type="text"
                className="input"
                placeholder="Correo o área…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div>
              <label className="label">
                Técnico <span className="text-red-600">*</span>
              </label>
              <select
                className="input"
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
                disabled={submitting || eligible.length === 0}
                size={Math.min(6, Math.max(2, eligible.length || 2))}
              >
                {eligible.length === 0 && (
                  <option value="" disabled>
                    Sin técnicos disponibles para esta área
                  </option>
                )}
                {eligible.map((t) => (
                  <option key={t.id} value={t.id}>
                    {getTechnicianDisplayLabel(t)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Solo se muestran técnicos cuyo rol cubre el área{" "}
                <strong>{ticket.responsibleArea}</strong>.
              </p>
            </div>
            <div>
              <label className="label">Nota (opcional)</label>
              <input
                type="text"
                className="input"
                placeholder="Motivo de la asignación manual"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={submitting}
              />
            </div>
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !technicianId}
              className="rounded bg-uta-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-uta-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitting ? "Asignando…" : "Asignar técnico"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
