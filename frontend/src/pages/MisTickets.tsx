// Sprint 2 (rev) - Vista "Mis Tickets" para el usuario solicitante.
// Lista los tickets que él creó, muestra estado de aceptación y permite ver
// el historial público de cada uno.
import { useCallback, useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";
import TicketHistoryModal from "../components/TicketHistoryModal";

interface Ticket {
  id: string;
  number: string;
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

interface MyResponse {
  tickets: Ticket[];
  total: number;
}

const STATUS_LABEL: Record<Ticket["status"], { label: string; classes: string }> = {
  abierto:    { label: "Pendiente",  classes: "bg-blue-100 text-blue-800" },
  en_proceso: { label: "En Proceso", classes: "bg-amber-100 text-amber-800" },
  escalado:   { label: "Escalado",   classes: "bg-purple-100 text-purple-800" },
  resuelto:   { label: "Resuelto",   classes: "bg-green-100 text-green-800" },
  cerrado:    { label: "Cerrado",    classes: "bg-gray-200 text-gray-700" },
};

function assignmentMessage(t: Ticket): { text: string; tone: "wait" | "ok" } {
  if (!t.assignedTechnicianId) {
    return { text: "Pendiente de aceptación por un técnico", tone: "wait" };
  }
  const verb = t.assignmentStatus === "assigned_by_admin" ? "asignado por admin a" : "aceptado por";
  return {
    text: `Ticket ${verb} ${t.assignedTechnicianName ?? "técnico"}`,
    tone: "ok",
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MisTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyTicket, setHistoryTicket] = useState<Ticket | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<MyResponse>("/api/tickets/my")
      .then((r) => {
        if (!cancelled) setTickets(r.data.tickets);
      })
      .catch((err) => {
        if (!cancelled) setError(extractApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  return (
    <Layout>
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-uta-900">Mis Tickets</h1>
          <p className="mt-1 text-sm text-gray-600">
            Historial de incidencias que has reportado.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600" />
            <p className="text-sm text-gray-500">Cargando tus tickets…</p>
          </div>
        )}

        {!loading && !error && tickets.length === 0 && (
          <div className="card py-12 text-center text-sm text-gray-500">
            Todavía no has creado tickets.
          </div>
        )}

        {!loading && tickets.length > 0 && (
          <div className="space-y-3">
            {tickets.map((t) => {
              const status = STATUS_LABEL[t.status] ?? { label: t.status, classes: "bg-gray-100 text-gray-700" };
              const assign = assignmentMessage(t);
              return (
                <div key={t.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-bold text-uta-900">{t.number}</span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${status.classes}`}>
                          {status.label}
                        </span>
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-700">
                          {t.responsibleArea}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 line-clamp-2">{t.detail}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {t.serviceName ?? "—"} · creado el {formatDate(t.createdAt)}
                      </p>
                      <p className={`mt-2 text-xs font-medium ${assign.tone === "ok" ? "text-green-700" : "text-amber-700"}`}>
                        {assign.text}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setHistoryTicket(t)}
                      className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Ver historial
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {historyTicket && (
          <TicketHistoryModal
            ticket={{
              id: historyTicket.id,
              number: historyTicket.number,
              serviceName: historyTicket.serviceName,
            }}
            audience="requester"
            onClose={() => setHistoryTicket(null)}
          />
        )}
      </div>
    </Layout>
  );
}
