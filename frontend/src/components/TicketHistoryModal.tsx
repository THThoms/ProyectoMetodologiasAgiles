// Modal compartido de historial de ticket. Lo consumen MisTickets (usuario),
// MisTicketsAceptados, PanelTecnicoV2 y AdminHistorial.
//
// El filtrado de eventos `internal` se hace ahora en el backend cuando el
// caller es el solicitante. Aquí dejamos un filtro defensivo extra controlado
// por `audience`: si "requester", se descartan los `internal` por si el
// servidor enviase alguno por equivocación.

import { useEffect, useState } from "react";
import { api, extractApiError } from "../lib/api";

export type HistoryAudience = "requester" | "staff";

export interface TicketHistoryRef {
  id: string;
  number: string;
  serviceName?: string | null;
}

interface HistoryEvent {
  id: string;
  actionType: string;
  description: string;
  reason: string | null;
  workDone?: string | null;
  eventDescription?: string | null;
  previousArea?: string | null;
  newArea?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  visibility?: "public" | "internal";
  performedBy: { id: string; name: string };
  createdAt: string;
}

interface Props {
  ticket: TicketHistoryRef;
  audience: HistoryAudience;
  onClose: () => void;
}

const ACTION_BADGE: Record<string, string> = {
  CREATED: "bg-blue-100 text-blue-800",
  CATEGORIZED: "bg-indigo-100 text-indigo-800",
  AVAILABLE: "bg-sky-100 text-sky-800",
  ACCEPTED: "bg-green-100 text-green-800",
  ASSIGNED: "bg-cyan-100 text-cyan-800",
  CONTRIBUTED: "bg-amber-100 text-amber-800",
  STATUS_CHANGED: "bg-purple-100 text-purple-800",
  ESCALATED: "bg-orange-100 text-orange-800",
  REASSIGNED: "bg-yellow-100 text-yellow-800",
  COMMENTED: "bg-gray-100 text-gray-700",
  RESOLVED: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-slate-200 text-slate-800",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TicketHistoryModal({ ticket, audience, onClose }: Props) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ history: HistoryEvent[] }>(`/api/tickets/history/${ticket.id}`)
      .then((r) => {
        if (cancelled) return;
        const all = r.data.history ?? [];
        // Defensa en frontend: solicitantes solo ven eventos públicos.
        setEvents(
          audience === "requester" ? all.filter((e) => e.visibility !== "internal") : all
        );
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
  }, [ticket.id, audience]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-bold text-uta-900">Historial del ticket</h2>
          <p className="mt-1 text-xs text-gray-600">
            <span className="font-mono font-semibold">{ticket.number}</span>
            {ticket.serviceName ? <> · {ticket.serviceName}</> : null}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="py-6 text-center text-sm text-gray-500">Cargando historial…</div>
          )}
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}
          {!loading && !error && events.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-500">
              No hay acciones registradas para este ticket.
            </p>
          )}
          {!loading && !error && events.length > 0 && (
            <ol className="relative space-y-4 border-l-2 border-gray-200 pl-6">
              {events.map((e) => {
                const badge = ACTION_BADGE[e.actionType] ?? "bg-gray-100 text-gray-700";
                return (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[33px] flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-uta-600 text-[10px] font-bold text-white">
                      ●
                    </span>
                    <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`}
                          >
                            {e.actionType}
                          </span>
                          {audience === "staff" && e.visibility === "internal" && (
                            <span className="inline-flex rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                              Interno
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">{formatDate(e.createdAt)}</span>
                      </div>
                      <p className="text-sm text-gray-800">{e.description}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        por <strong>{e.performedBy.name}</strong>
                      </p>
                      {e.reason && (
                        <p className="mt-2 rounded bg-gray-50 px-2 py-1 text-xs italic text-gray-700">
                          Motivo: {e.reason}
                        </p>
                      )}
                      {e.workDone && (
                        <p className="mt-1 rounded bg-gray-50 px-2 py-1 text-xs italic text-gray-700">
                          Trabajo: {e.workDone}
                        </p>
                      )}
                      {e.eventDescription && (
                        <p className="mt-1 rounded bg-gray-50 px-2 py-1 text-xs text-gray-700">
                          {e.eventDescription}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="flex justify-end border-t border-gray-200 bg-gray-50 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
