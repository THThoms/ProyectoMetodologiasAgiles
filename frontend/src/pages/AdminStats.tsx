// Sprint 2 (rev) - Dashboard de estadísticas del administrador.
// Sin dependencia de librerías de gráficas: tarjetas + barras CSS simples.
// Permite también asignar manualmente tickets a técnicos.

import { useCallback, useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";

interface StatsResponse {
  totals: {
    tickets: number; pending: number; inProgress: number;
    escalated: number; resolved: number; closed: number;
    accepted: number; available: number;
  };
  byService: Array<{ service: string; count: number }>;
  byResponsibleArea: Array<{ area: string; count: number }>;
  byPriority: Array<{ priority: string; count: number }>;
  byTechnician: Array<{ technicianId: string | null; technicianName: string; count: number }>;
  avgAcceptSeconds: number | null;
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

function formatSecs(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return `${h} h`;
}

export default function AdminStats() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [tickets, setTickets] = useState<UnassignedTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<UnassignedTicket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, t] = await Promise.all([
        api.get<StatsResponse>("/api/admin/stats/tickets"),
        api.get<{ tickets: UnassignedTicket[]; areas: string[] }>("/api/tickets/available"),
      ]);
      setStats(s.data);
      setTickets(t.data.tickets);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Layout>
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-uta-900">Estadísticas administrativas</h1>
          <p className="mt-1 text-sm text-gray-600">
            Visión general de tickets, áreas, prioridades y carga por técnico.
          </p>
        </div>

        {flash && (
          <div className="mb-4 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
            {flash}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        )}

        {loading && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600" />
            <p className="text-sm text-gray-500">Cargando estadísticas…</p>
          </div>
        )}

        {!loading && stats && (
          <>
            {/* Totales */}
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Totales</h2>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <StatCard label="Tickets"    value={stats.totals.tickets}    color="text-uta-900" />
              <StatCard label="Disponibles" value={stats.totals.available}  color="text-blue-700" />
              <StatCard label="Pendientes"  value={stats.totals.pending}    color="text-blue-600" />
              <StatCard label="En Proceso"  value={stats.totals.inProgress} color="text-amber-600" />
              <StatCard label="Aceptados"   value={stats.totals.accepted}   color="text-cyan-700" />
              <StatCard label="Escalados"   value={stats.totals.escalated}  color="text-purple-600" />
              <StatCard label="Resueltos"   value={stats.totals.resolved}   color="text-green-600" />
              <StatCard label="Cerrados"    value={stats.totals.closed}     color="text-gray-700" />
            </div>

            {stats.avgAcceptSeconds != null && (
              <div className="card mb-6">
                <p className="text-xs font-semibold uppercase text-gray-500">Tiempo promedio de aceptación</p>
                <p className="mt-1 text-xl font-bold text-uta-900">{formatSecs(stats.avgAcceptSeconds)}</p>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <BarList title="Por área responsable" items={stats.byResponsibleArea.map(b => ({ label: b.area, count: b.count }))} />
              <BarList title="Por prioridad"        items={stats.byPriority.map(b => ({ label: b.priority, count: b.count }))} />
              <BarList title="Por servicio"         items={stats.byService.map(b => ({ label: b.service, count: b.count }))} />
              <BarList title="Por técnico"          items={stats.byTechnician.map(b => ({ label: b.technicianName, count: b.count }))} />
            </div>
          </>
        )}

        {/* Asignación manual */}
        <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Tickets sin asignar
        </h2>
        {tickets.length === 0 ? (
          <p className="card py-4 text-center text-sm text-gray-500">Ningún ticket pendiente de asignación.</p>
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
                      <span className="inline-flex rounded bg-uta-50 px-2 py-0.5 text-xs font-bold text-uta-900">{t.responsibleArea}</span>
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

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
    </div>
  );
}

function BarList({ title, items }: { title: string; items: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="card">
      <h3 className="mb-3 text-sm font-semibold text-uta-900">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">Sin datos.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.label}>
              <div className="mb-0.5 flex justify-between text-xs text-gray-700">
                <span>{i.label}</span>
                <span className="font-semibold">{i.count}</span>
              </div>
              <div className="h-2 w-full rounded bg-gray-100">
                <div
                  className="h-2 rounded bg-uta-700"
                  style={{ width: `${(i.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Modal de asignación manual: el admin elige un técnico (necesita conocer su UUID).
// Para simplificar, pedimos el ID del técnico vía input. Una versión más completa
// haría un dropdown leyendo /auth/users — fuera de scope inmediato.
function AssignModal({
  ticket, onClose, onSuccess,
}: { ticket: UnassignedTicket; onClose: () => void; onSuccess: () => void }) {
  const [technicianId, setTechnicianId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[0-9a-f-]{36}$/i.test(technicianId.trim())) {
      setError("ID de técnico inválido (debe ser UUID).");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/api/admin/tickets/${ticket.id}/assign`, {
        technicianId: technicianId.trim(),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <form onSubmit={submit}>
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-bold text-uta-900">Asignar ticket manualmente</h2>
            <p className="mt-1 text-sm text-gray-600">
              <span className="font-mono font-semibold">{ticket.number}</span> · área {ticket.responsibleArea}
            </p>
          </div>
          <div className="space-y-3 px-6 py-5">
            <div>
              <label className="label">ID del técnico (UUID)</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. 11111111-1111-4111-8111-bbbbbbbbbbbb"
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
                disabled={submitting}
                autoFocus
              />
              <p className="mt-1 text-xs text-gray-500">
                El técnico debe estar activo y cubrir el área <strong>{ticket.responsibleArea}</strong>.
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
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-3">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={submitting} className="rounded bg-uta-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-uta-800 disabled:cursor-not-allowed disabled:bg-gray-300">
              {submitting ? "Asignando…" : "Asignar técnico"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
