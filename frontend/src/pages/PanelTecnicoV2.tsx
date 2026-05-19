// Sprint 2 (rev) - Panel técnico con tabs Disponibles / Aceptados.
// Reemplaza la lógica por niveles N1-N4 por filtrado por área responsable.

import { useCallback, useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";
import { getCurrentUser } from "../lib/auth";

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

  const [actionTicket, setActionTicket] = useState<{ ticket: Ticket; mode: "contribute" | "escalate" } | null>(null);

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
                          <div className="flex gap-1.5">
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
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Modal: aportación
// ---------------------------------------------------------------------------
function ContributionModal({ ticket, onClose, onSuccess }: { ticket: Ticket; onClose: () => void; onSuccess: () => void }) {
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "internal">("public");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = description.trim().length < 5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) {
      setError("La aportación debe tener al menos 5 caracteres.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/tickets/${ticket.id}/contributions`, {
        description: description.trim(),
        visibility,
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
            <h2 className="text-lg font-bold text-uta-900">Agregar aportación</h2>
            <p className="mt-1 text-sm text-gray-600">
              Ticket <span className="font-mono font-semibold">{ticket.number}</span>
            </p>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div>
              <label htmlFor="contrib-desc" className="label">Descripción / avance</label>
              <textarea
                id="contrib-desc"
                className="input min-h-[120px]"
                placeholder="Ej: Se revisó el router del bloque B y se reinició el AP."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="contrib-vis" className="label">Visibilidad</label>
              <select
                id="contrib-vis"
                className="input"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as "public" | "internal")}
                disabled={submitting}
              >
                <option value="public">Pública — el usuario solicitante la verá</option>
                <option value="internal">Interna — solo técnicos / admin</option>
              </select>
            </div>
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-3">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={submitting || invalid} className="rounded bg-uta-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-uta-800 disabled:cursor-not-allowed disabled:bg-gray-300">
              {submitting ? "Guardando…" : "Guardar aportación"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal: escalamiento mejorado
// ---------------------------------------------------------------------------
function EscalateV2Modal({ ticket, onClose, onSuccess }: { ticket: Ticket; onClose: () => void; onSuccess: () => void }) {
  const [reason, setReason] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [targetArea, setTargetArea] = useState<string>(ticket.responsibleArea);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = reason.trim().length < 5 || workDone.trim().length < 5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) {
      setError("Motivo y trabajo previo son obligatorios (mínimo 5 caracteres cada uno).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.put(`/api/tickets/${ticket.id}/escalate`, {
        reason: reason.trim(),
        workDone: workDone.trim(),
        targetArea,
        description: description.trim() || undefined,
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
            <h2 className="text-lg font-bold text-uta-900">Escalar ticket</h2>
            <p className="mt-1 text-sm text-gray-600">
              <span className="font-mono font-semibold">{ticket.number}</span> · área actual: {ticket.responsibleArea}
            </p>
          </div>
          <div className="space-y-3 px-6 py-5">
            <div>
              <label className="label">Motivo del escalamiento <span className="text-red-600">*</span></label>
              <textarea
                className="input min-h-[80px]"
                placeholder="¿Por qué se debe escalar?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                autoFocus
              />
            </div>
            <div>
              <label className="label">¿Qué se hizo antes de escalar? <span className="text-red-600">*</span></label>
              <textarea
                className="input min-h-[80px]"
                placeholder="Trabajo previo realizado por el técnico."
                value={workDone}
                onChange={(e) => setWorkDone(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div>
              <label className="label">Área destino</label>
              <select
                className="input"
                value={targetArea}
                onChange={(e) => setTargetArea(e.target.value)}
                disabled={submitting}
              >
                <option value="TECHNICIANS">TECHNICIANS</option>
                <option value="TICS">TICS</option>
                <option value="GENERAL">GENERAL</option>
              </select>
            </div>
            <div>
              <label className="label">Descripción adicional (opcional)</label>
              <input
                type="text"
                className="input"
                placeholder="Notas para el área destino."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
              />
            </div>
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-3">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={submitting || invalid} className="rounded bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-gray-300">
              {submitting ? "Escalando…" : "Confirmar escalamiento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
