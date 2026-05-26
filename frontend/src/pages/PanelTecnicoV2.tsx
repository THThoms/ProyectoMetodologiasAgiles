// Sprint 2 (rev) - Panel técnico con tabs Disponibles / Aceptados.
// Reemplaza la lógica por niveles N1-N4 por filtrado por área responsable.

import { useCallback, useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";
import { getCurrentUser } from "../lib/auth";
import { ContributionModal, EscalateV2Modal } from "../components/TicketActionModals";
import ResolveTicketModal from "../components/ResolveTicketModal";
import TicketHistoryModal from "../components/TicketHistoryModal";

interface Ticket {
  id: string;
  number: string;
  userName: string | null;
  userEmail: string | null;
  serviceId: string;
  serviceName: string | null;
  detail: string;
  status: "abierto" | "en_proceso" | "escalado" | "resuelto" | "cerrado";
  priority: "baja" | "media" | "alta" | "critica";
  responsibleArea: "TECHNICIANS" | "TICS" | "GENERAL";
  assignmentStatus: "unassigned" | "available" | "accepted" | "assigned_by_admin";
  assignedTechnicianId: string | null;
  assignedTechnicianName: string | null;
  acceptedAt: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  knowledgeArticleId?: string | null;
}

const STATUS_BADGE: Record<Ticket["status"], { label: string; classes: string }> = {
  abierto:    { label: "Pendiente",  classes: "bg-blue-100 text-blue-800" },
  en_proceso: { label: "En Proceso", classes: "bg-amber-100 text-amber-800" },
  escalado:   { label: "Escalado",   classes: "bg-purple-100 text-purple-800" },
  resuelto:   { label: "Resuelto",   classes: "bg-green-100 text-green-800" },
  cerrado:    { label: "Cerrado",    classes: "bg-gray-200 text-gray-700" },
};

const PRIORITY_BADGE: Record<Ticket["priority"], { label: string; classes: string }> = {
  baja:    { label: "Baja",    classes: "bg-gray-100 text-gray-700" },
  media:   { label: "Media",   classes: "bg-blue-100 text-blue-700" },
  alta:    { label: "Alta",    classes: "bg-orange-100 text-orange-800" },
  critica: { label: "Crítica", classes: "bg-red-100 text-red-800" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function PanelTecnicoV2() {
  const user = getCurrentUser();
  const role = user?.role ?? "user";
  const [tab, setTab] = useState<"available" | "accepted">("available");
  const [available, setAvailable] = useState<Ticket[]>([]);
  const [accepted, setAccepted] = useState<Ticket[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [actionTicket, setActionTicket] = useState<{ ticket: Ticket; mode: "contribute" | "escalate" | "resolve" } | null>(null);
  const [historyTicket, setHistoryTicket] = useState<Ticket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [avRes, acRes] = await Promise.all([
        api.get<{ tickets: Ticket[]; areas: string[] }>("/api/tickets/available"),
        api.get<{ tickets: Ticket[] }>("/api/tickets/accepted"),
      ]);
      setAvailable(avRes.data.tickets);
      setAreas(avRes.data.areas ?? []);
      setAccepted(acRes.data.tickets);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function acceptTicket(t: Ticket) {
    setError(null);
    try {
      await api.post(`/api/tickets/${t.id}/accept`);
      setFlash(`Aceptaste el ticket ${t.number}`);
      await load();
      window.setTimeout(() => setFlash(null), 5000);
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  const tickets = tab === "available" ? available : accepted;

  return (
    <Layout>
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-uta-900">Panel Técnico</h1>
          <p className="mt-1 text-sm text-gray-600">
            {user?.name} · <span className="uppercase">{role}</span> · áreas: {areas.join(", ") || "—"}
          </p>
        </div>

        {/* Resumen */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="card border-blue-200 text-center">
            <p className="text-3xl font-bold text-blue-600">{available.length}</p>
            <p className="text-xs font-semibold text-gray-500">Tickets disponibles</p>
          </div>
          <div className="card border-amber-200 text-center">
            <p className="text-3xl font-bold text-amber-600">{accepted.length}</p>
            <p className="text-xs font-semibold text-gray-500">Mis tickets aceptados</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-2 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setTab("available")}
            className={`px-4 py-2 text-sm font-semibold transition ${
              tab === "available"
                ? "border-b-2 border-uta-700 text-uta-900"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Disponibles ({available.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("accepted")}
            className={`px-4 py-2 text-sm font-semibold transition ${
              tab === "accepted"
                ? "border-b-2 border-uta-700 text-uta-900"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Mis aceptados ({accepted.length})
          </button>
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
            <p className="text-sm text-gray-500">Cargando tickets…</p>
          </div>
        )}

        {!loading && tickets.length === 0 && (
          <div className="card py-12 text-center text-sm text-gray-500">
            {tab === "available"
              ? "No hay tickets disponibles en tus áreas en este momento."
              : "No tienes tickets aceptados todavía. Toma uno desde la pestaña Disponibles."}
          </div>
        )}

        {!loading && tickets.length > 0 && (
          <div className="card overflow-x-auto p-0">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Ticket</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Solicitante</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Servicio</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Área</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Prioridad</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Estado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{tab === "available" ? "Creado" : "Aceptado"}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {tickets.map((t) => {
                  const s = STATUS_BADGE[t.status] ?? { label: t.status, classes: "bg-gray-100 text-gray-700" };
                  const p = PRIORITY_BADGE[t.priority] ?? { label: t.priority, classes: "bg-gray-100 text-gray-700" };
                  return (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-uta-900">{t.number}</td>
                      <td className="px-4 py-3 text-gray-700 truncate max-w-[180px]" title={t.userEmail ?? ""}>
                        {t.userName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-700 truncate max-w-[180px]">{t.serviceName ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex rounded bg-uta-50 px-2 py-0.5 text-xs font-bold text-uta-900">
                          {t.responsibleArea}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${p.classes}`}>{p.label}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.classes}`}>{s.label}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {formatDate(tab === "available" ? t.createdAt : (t.acceptedAt ?? t.createdAt))}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {tab === "available" ? (
                          <button
                            type="button"
                            onClick={() => acceptTicket(t)}
                            disabled={role === "admin"}
                            title={role === "admin" ? "El admin debe usar la asignación manual" : "Aceptar ticket"}
                            className="rounded bg-uta-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-uta-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            Aceptar
                          </button>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => setHistoryTicket(t)}
                              className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              Historial
                            </button>
                            <button
                              type="button"
                              onClick={() => setActionTicket({ ticket: t, mode: "contribute" })}
                              className="rounded border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                            >
                              Aportar
                            </button>
                            <button
                              type="button"
                              onClick={() => setActionTicket({ ticket: t, mode: "escalate" })}
                              disabled={t.status === "resuelto" || t.status === "cerrado"}
                              className="rounded bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                            >
                              Escalar
                            </button>
                            <button
                              type="button"
                              onClick={() => setActionTicket({ ticket: t, mode: "resolve" })}
                              disabled={t.status === "resuelto" || t.status === "cerrado"}
                              className="rounded bg-green-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                            >
                              Resolver
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {actionTicket?.mode === "contribute" && (
          <ContributionModal
            ticket={actionTicket.ticket}
            onClose={() => setActionTicket(null)}
            onSuccess={() => {
              setActionTicket(null);
              setFlash("Aportación registrada");
              load();
              window.setTimeout(() => setFlash(null), 5000);
            }}
          />
        )}
        {actionTicket?.mode === "escalate" && (
          <EscalateV2Modal
            ticket={actionTicket.ticket}
            onClose={() => setActionTicket(null)}
            onSuccess={() => {
              setActionTicket(null);
              setFlash("Ticket escalado");
              load();
              window.setTimeout(() => setFlash(null), 5000);
            }}
          />
        )}
        {actionTicket?.mode === "resolve" && (
          <ResolveTicketModal
            ticket={{
              id: actionTicket.ticket.id,
              number: actionTicket.ticket.number,
              serviceId: actionTicket.ticket.serviceId,
              serviceName: actionTicket.ticket.serviceName,
              responsibleArea: actionTicket.ticket.responsibleArea,
            }}
            onClose={() => setActionTicket(null)}
            onSuccess={() => {
              setActionTicket(null);
              setFlash("Ticket resuelto correctamente");
              load();
              window.setTimeout(() => setFlash(null), 5000);
            }}
          />
        )}

        {historyTicket && (
          <TicketHistoryModal
            ticket={{
              id: historyTicket.id,
              number: historyTicket.number,
              serviceName: historyTicket.serviceName,
            }}
            audience="staff"
            onClose={() => setHistoryTicket(null)}
          />
        )}
      </div>
    </Layout>
  );
}

