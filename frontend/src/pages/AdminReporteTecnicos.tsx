// HU-16 - Reporte individual de técnico (solo admin).
//
// Reutiliza:
//   - Layout + card + Tailwind (misma línea visual)
//   - DonutChart / BarChart / LineChart (SVG custom, sin dependencias)
//   - getTechnicianDisplayLabel / getResponsibleAreaLabel del helper compartido
//   - Estrategia de "Imprimir / Guardar PDF" con window.open + window.print()
//     (misma que HU-14 Historial). El botón "Guardar PDF" es idéntico a Imprimir:
//     el navegador ofrece "Guardar como PDF" en su diálogo estándar.
//     Justificación: NO se instala nueva dependencia (jspdf/puppeteer). Coherente
//     con la arquitectura actual y funciona en todos los navegadores modernos.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";
import DonutChart, { DonutSlice } from "../components/charts/DonutChart";
import BarChart from "../components/charts/BarChart";
import LineChart from "../components/charts/LineChart";
import {
  getResponsibleAreaLabel,
  getTechnicianDisplayLabel,
} from "../lib/technician";
import { getCurrentUser } from "../lib/auth";

// -----------------------------------------------------------------------------
// Tipos que espeja el backend (technicianReportService).
// -----------------------------------------------------------------------------
interface Technician {
  id: string;
  name: string;
  email: string;
  role: string;
  areas: ("TECHNICIANS" | "DTIC")[];
  isActive: boolean;
}

interface ReportSummary {
  ticketsAssigned: number;
  ticketsAccepted: number;
  ticketsInProgress: number;
  ticketsEscalated: number;
  ticketsResolved: number;
  ticketsClosed: number;
  contributions: number;
  reescalations: number;
  distinctServices: number;
}

interface ReportTicket {
  id: string;
  number: string;
  createdAt: string;
  title: string;
  detail: string | null;
  serviceName: string | null;
  responsibleArea: "TECHNICIANS" | "DTIC";
  priority: "baja" | "media" | "alta" | "critica";
  status: "abierto" | "en_proceso" | "escalado" | "resuelto" | "cerrado";
  requesterName: string | null;
  requesterEmail: string | null;
  assignedTechnicianName: string | null;
  acceptedAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionSummary: string | null;
  knowledgeArticleId: string | null;
}

interface ReportActivity {
  id: string;
  ticketId: string;
  ticketNumber: string | null;
  createdAt: string;
  actionType: string;
  performedByName: string;
  description: string | null;
  reason: string | null;
  workDone: string | null;
  previousArea: string | null;
  newArea: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  visibility: string;
}

interface ReportEscalation {
  ticketNumber: string | null;
  createdAt: string;
  previousArea: string | null;
  newArea: string | null;
  reason: string | null;
  workDone: string | null;
  performedByName: string;
}

interface ReportResolution {
  ticketNumber: string;
  serviceName: string | null;
  problemDescription: string | null;
  resolvedAt: string | null;
  resolutionSummary: string | null;
  knowledgeArticleId: string | null;
  resolvedByName: string | null;
}

interface ReportContribution {
  ticketNumber: string | null;
  createdAt: string;
  performedByName: string;
  description: string | null;
}

interface CountByLabel {
  label: string;
  count: number;
}

interface MonthlySeriesPoint {
  month: string;
  count: number;
}

interface TechnicianReport {
  technician: Technician;
  range: { from: string | null; to: string | null };
  generatedAt: string;
  summary: ReportSummary;
  tickets: ReportTicket[];
  activity: ReportActivity[];
  escalations: ReportEscalation[];
  resolutions: ReportResolution[];
  contributions: ReportContribution[];
  byService: CountByLabel[];
  byStatus: CountByLabel[];
  byPriority: CountByLabel[];
  byMonth: MonthlySeriesPoint[];
}

// -----------------------------------------------------------------------------
// Etiquetas y colores (mismos que AdminStats para consistencia visual)
// -----------------------------------------------------------------------------
const STATUS_LABEL: Record<string, string> = {
  abierto: "Pendiente",
  en_proceso: "En Proceso",
  escalado: "Escalado",
  resuelto: "Resuelto",
  cerrado: "Cerrado",
};
const PRIORITY_LABEL: Record<string, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  critica: "Crítica",
};
const STATUS_COLORS: Record<string, string> = {
  abierto: "#3b82f6",
  en_proceso: "#f59e0b",
  escalado: "#8b5cf6",
  resuelto: "#10b981",
  cerrado: "#64748b",
};
const PRIORITY_COLORS: Record<string, string> = {
  baja: "#94a3b8",
  media: "#3b82f6",
  alta: "#f97316",
  critica: "#dc2626",
};

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("T")[0].split("-");
  return `${d}/${m}/${y}`;
}
// Fecha + hora en formato DD/MM/AAAA HH:MM (para "Fecha de generación").
function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function esc(v: string | null | undefined): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// -----------------------------------------------------------------------------
// Accesos rápidos de rango
// -----------------------------------------------------------------------------
function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function isoMonths(nMonths: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - nMonths);
  return d.toISOString().slice(0, 10);
}
function isoYearStart(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-01-01`;
}

// -----------------------------------------------------------------------------
// Períodos institucionales UTA — CONFIGURABLES.
// Agregar/modificar aquí cuando la universidad publique un nuevo calendario.
// El label es lo que se muestra en el encabezado del reporte y en el PDF.
// Las fechas se aplican tal cual al filtro from/to del backend.
// -----------------------------------------------------------------------------
interface InstitutionalPeriod {
  id: string;
  label: string;
  from: string; // YYYY-MM-DD
  to: string;
}
const INSTITUTIONAL_PERIODS: InstitutionalPeriod[] = [
  {
    id: "uta-2026-ene-jul",
    label: "PERÍODO ACADÉMICO ORDINARIO ENERO - JULIO 2026",
    from: "2026-01-01",
    to: "2026-07-31",
  },
  {
    id: "uta-2026-jul-dic",
    label: "PERÍODO ACADÉMICO JULIO - DICIEMBRE 2026",
    from: "2026-07-01",
    to: "2026-12-31",
  },
];

// Labels de los presets dinámicos. NO llamamos "período académico" a nada que
// no sea un período institucional real.
const PRESET_LABEL = {
  ALL: "TODO EL HISTORIAL",
  LAST30: "ÚLTIMOS 30 DÍAS",
  LAST3M: "ÚLTIMOS 3 MESES",
  LAST6M: "ÚLTIMOS 6 MESES",
  THIS_YEAR: "ESTE AÑO",
  CUSTOM: "RANGO PERSONALIZADO",
} as const;

// -----------------------------------------------------------------------------
// Componente principal
// -----------------------------------------------------------------------------
export default function AdminReporteTecnicos() {
  const admin = getCurrentUser();
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Nombre del período que verá el reporte y el PDF. Se actualiza al aplicar
  // un preset o al elegir un período institucional; si el admin edita las
  // fechas manualmente pasa a "RANGO PERSONALIZADO" / "TODO EL HISTORIAL".
  const [periodLabel, setPeriodLabel] = useState<string>(PRESET_LABEL.ALL);
  // periodLabelSnapshot es lo que se muestra en el reporte generado (queda
  // congelado con lo que el admin eligió al hacer clic en "Generar").
  const [periodLabelSnapshot, setPeriodLabelSnapshot] = useState<string>(PRESET_LABEL.ALL);
  const [report, setReport] = useState<TechnicianReport | null>(null);
  const [loadingTechs, setLoadingTechs] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);

  // Carga inicial: lista de técnicos.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ technicians: Technician[] }>("/api/admin/technicians")
      .then((r) => {
        if (!cancelled) setTechnicians(r.data.technicians);
      })
      .catch((err) => {
        if (!cancelled) setError(extractApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingTechs(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rangeInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);

  const generate = useCallback(async () => {
    if (!selectedId) {
      setError("Selecciona un técnico primero.");
      return;
    }
    if (rangeInvalid) {
      setDateError("La fecha inicial no puede ser posterior a la fecha final.");
      return;
    }
    setDateError(null);
    setError(null);
    setLoadingReport(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      const qs = params.toString();
      const url = `/api/admin/reports/technicians/${selectedId}${qs ? `?${qs}` : ""}`;
      const r = await api.get<TechnicianReport>(url);
      setReport(r.data);
      // Congela el nombre del período mostrado en el reporte generado.
      setPeriodLabelSnapshot(periodLabel);
    } catch (err) {
      setError(extractApiError(err));
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [selectedId, dateFrom, dateTo, rangeInvalid, periodLabel]);

  function applyQuickRange(from: string, to: string, label: string) {
    setDateFrom(from);
    setDateTo(to);
    setPeriodLabel(label);
    setDateError(from && to && from > to ? "Rango inválido." : null);
  }
  function clearRange() {
    setDateFrom("");
    setDateTo("");
    setPeriodLabel(PRESET_LABEL.ALL);
    setDateError(null);
  }
  function applyInstitutionalPeriod(id: string) {
    if (!id) return;
    const p = INSTITUTIONAL_PERIODS.find((x) => x.id === id);
    if (!p) return;
    setDateFrom(p.from);
    setDateTo(p.to);
    setPeriodLabel(p.label);
    setDateError(null);
  }
  // Si el admin edita fechas manualmente, el label cae a RANGO PERSONALIZADO
  // (o TODO EL HISTORIAL si ambas quedan vacías). No se llama automáticamente
  // "período académico" a algo que no lo es.
  function markCustom(nextFrom: string, nextTo: string) {
    if (!nextFrom && !nextTo) setPeriodLabel(PRESET_LABEL.ALL);
    else setPeriodLabel(PRESET_LABEL.CUSTOM);
  }

  // Series para los gráficos (memo).
  const statusDonut: DonutSlice[] = useMemo(() => {
    if (!report) return [];
    return report.byStatus.map((r) => ({
      label: STATUS_LABEL[r.label] ?? r.label,
      value: r.count,
      color: STATUS_COLORS[r.label] ?? "#94a3b8",
    }));
  }, [report]);
  const priorityDonut: DonutSlice[] = useMemo(() => {
    if (!report) return [];
    return report.byPriority.map((r) => ({
      label: PRIORITY_LABEL[r.label] ?? r.label,
      value: r.count,
      color: PRIORITY_COLORS[r.label] ?? "#94a3b8",
    }));
  }, [report]);
  const serviceBars = useMemo(() => {
    if (!report) return [];
    return report.byService
      .slice(0, 10)
      .map((r) => ({ label: r.label, value: r.count }));
  }, [report]);
  const monthLine = useMemo(() => {
    if (!report) return [];
    return report.byMonth.map((p) => ({ date: p.month, value: p.count }));
  }, [report]);

  const selectedTech = technicians.find((t) => t.id === selectedId) ?? null;

  // -----------------------------------------------------------------
  // Impresión / PDF: window.open con HTML autocontenido (misma técnica
  // que HU-14). El botón "Guardar PDF" es idéntico a "Imprimir": el
  // navegador ofrece "Guardar como PDF" en el diálogo de impresión.
  // -----------------------------------------------------------------
  function buildPrintHtml(): string {
    if (!report) return "";
    const r = report;
    const generatedAtStr = formatDateTime(r.generatedAt);
    const areaLabel =
      r.technician.areas.map(getResponsibleAreaLabel).join(" / ") ||
      getResponsibleAreaLabel(r.technician.areas[0] ?? "TECHNICIANS");

    const summaryRows: Array<[string, string]> = [
      ["Tickets asignados", String(r.summary.ticketsAssigned)],
      ["Tickets aceptados", String(r.summary.ticketsAccepted)],
      ["Tickets en proceso", String(r.summary.ticketsInProgress)],
      ["Tickets resueltos", String(r.summary.ticketsResolved)],
      ["Tickets cerrados", String(r.summary.ticketsClosed)],
      ["Reescalamientos", String(r.summary.reescalations)],
      ["Aportaciones", String(r.summary.contributions)],
      ["Servicios distintos atendidos", String(r.summary.distinctServices)],
    ];
    const summaryHtml =
      `<table class="meta">` +
      summaryRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("") +
      `</table>`;

    const ticketsHtml = r.tickets.length
      ? `<table class="tbl"><thead><tr>
           <th>Número</th><th>Fecha</th><th>Servicio</th><th>Área</th>
           <th>Prioridad</th><th>Estado</th><th>Solicitante</th><th>Resuelto</th>
         </tr></thead><tbody>` +
        r.tickets
          .map(
            (t) => `<tr>
              <td>${esc(t.number)}</td>
              <td>${esc(formatDay(t.createdAt))}</td>
              <td>${esc(t.serviceName ?? "—")}</td>
              <td>${esc(getResponsibleAreaLabel(t.responsibleArea))}</td>
              <td>${esc(PRIORITY_LABEL[t.priority] ?? t.priority)}</td>
              <td>${esc(STATUS_LABEL[t.status] ?? t.status)}</td>
              <td>${esc(t.requesterName ?? "—")}</td>
              <td>${esc(t.resolvedAt ? formatDay(t.resolvedAt) : "—")}</td>
            </tr>`
          )
          .join("") +
        `</tbody></table>`
      : `<p class="empty">Sin tickets en el período.</p>`;

    const activityHtml = r.activity.length
      ? `<table class="tbl"><thead><tr>
          <th>Fecha</th><th>Ticket</th><th>Acción</th><th>Descripción</th>
         </tr></thead><tbody>` +
        r.activity
          .map(
            (a) => `<tr>
              <td>${esc(formatDay(a.createdAt))}</td>
              <td>${esc(a.ticketNumber ?? "—")}</td>
              <td>${esc(a.actionType)}</td>
              <td>${esc(a.description ?? a.reason ?? a.workDone ?? "—")}</td>
            </tr>`
          )
          .join("") +
        `</tbody></table>`
      : `<p class="empty">Sin actividad en el período.</p>`;

    const escHtml = r.escalations.length
      ? `<table class="tbl"><thead><tr>
          <th>Ticket</th><th>Fecha</th><th>Área anterior</th><th>Área nueva</th>
          <th>Motivo</th><th>Trabajo previo</th>
         </tr></thead><tbody>` +
        r.escalations
          .map(
            (e) => `<tr>
              <td>${esc(e.ticketNumber ?? "—")}</td>
              <td>${esc(formatDay(e.createdAt))}</td>
              <td>${esc(e.previousArea ? getResponsibleAreaLabel(e.previousArea) : "—")}</td>
              <td>${esc(e.newArea ? getResponsibleAreaLabel(e.newArea) : "—")}</td>
              <td>${esc(e.reason ?? "—")}</td>
              <td>${esc(e.workDone ?? "—")}</td>
            </tr>`
          )
          .join("") +
        `</tbody></table>`
      : `<p class="empty">Sin reescalamientos en el período.</p>`;

    const resHtml = r.resolutions.length
      ? `<table class="tbl"><thead><tr>
          <th>Ticket</th><th>Servicio</th><th>Problema</th><th>Resuelto el</th><th>Resumen</th>
         </tr></thead><tbody>` +
        r.resolutions
          .map(
            (x) => `<tr>
              <td>${esc(x.ticketNumber)}</td>
              <td>${esc(x.serviceName ?? "—")}</td>
              <td>${esc(x.problemDescription ?? "—")}</td>
              <td>${esc(x.resolvedAt ? formatDay(x.resolvedAt) : "—")}</td>
              <td>${esc(x.resolutionSummary ?? "—")}</td>
            </tr>`
          )
          .join("") +
        `</tbody></table>`
      : `<p class="empty">Sin resoluciones en el período.</p>`;

    const contribHtml = r.contributions.length
      ? `<table class="tbl"><thead><tr>
          <th>Ticket</th><th>Fecha</th><th>Descripción</th>
         </tr></thead><tbody>` +
        r.contributions
          .map(
            (c) => `<tr>
              <td>${esc(c.ticketNumber ?? "—")}</td>
              <td>${esc(formatDay(c.createdAt))}</td>
              <td>${esc(c.description ?? "—")}</td>
            </tr>`
          )
          .join("") +
        `</tbody></table>`
      : `<p class="empty">Sin aportaciones en el período.</p>`;

    const svcStats = r.byService.length
      ? `<table class="tbl"><thead><tr><th>Servicio</th><th>Tickets</th></tr></thead><tbody>` +
        r.byService
          .map((b) => `<tr><td>${esc(b.label)}</td><td>${esc(String(b.count))}</td></tr>`)
          .join("") +
        `</tbody></table>`
      : `<p class="empty">Sin datos.</p>`;
    const statusStats = r.byStatus.length
      ? `<table class="tbl"><thead><tr><th>Estado</th><th>Tickets</th></tr></thead><tbody>` +
        r.byStatus
          .map(
            (b) =>
              `<tr><td>${esc(STATUS_LABEL[b.label] ?? b.label)}</td><td>${esc(String(b.count))}</td></tr>`
          )
          .join("") +
        `</tbody></table>`
      : `<p class="empty">Sin datos.</p>`;
    const priorityStats = r.byPriority.length
      ? `<table class="tbl"><thead><tr><th>Prioridad</th><th>Tickets</th></tr></thead><tbody>` +
        r.byPriority
          .map(
            (b) =>
              `<tr><td>${esc(PRIORITY_LABEL[b.label] ?? b.label)}</td><td>${esc(String(b.count))}</td></tr>`
          )
          .join("") +
        `</tbody></table>`
      : `<p class="empty">Sin datos.</p>`;

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Reporte técnico ${esc(r.technician.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#000; background:#fff; margin:24px; font-size:12px; }
  h1 { font-size:16px; margin:0; }
  h2 { font-size:14px; margin:18px 0 8px; border-bottom:1px solid #ccc; padding-bottom:4px; }
  /* --- Encabezado en 4 bloques --- */
  header.doc { border:1px solid #1e3a8a; border-radius:4px; overflow:hidden; margin-bottom:18px; page-break-inside:avoid; }
  header .inst-block { background:#eff6ff; border-bottom:2px solid #1e3a8a; padding:12px 16px; text-align:center; }
  header .inst-block .inst { font-size:11px; font-weight:bold; letter-spacing:2px; color:#1e3a8a; text-transform:uppercase; }
  header .inst-block .sys { font-size:11px; color:#555; margin-top:2px; }
  header .inst-block h1 { font-size:15px; margin-top:8px; text-transform:uppercase; letter-spacing:1px; color:#1e3a8a; }
  header .section { padding:10px 16px; border-bottom:1px solid #e5e7eb; }
  header .section:last-child { border-bottom:none; }
  header .section .sec-title { font-size:10px; font-weight:bold; letter-spacing:2px; color:#666; text-transform:uppercase; margin:0 0 6px; }
  header .row { display:flex; flex-wrap:wrap; gap:20px; }
  header .field { flex:1 1 200px; }
  header .field .label { font-size:10px; color:#666; margin:0; }
  header .field .value { font-size:12px; color:#111; font-weight:600; margin:1px 0 0; }
  header .field .value.big { font-size:16px; font-weight:bold; color:#1e3a8a; }
  /* --- Tablas --- */
  table.meta { width:100%; border-collapse:collapse; margin:12px 0 16px; }
  table.meta th, table.meta td { text-align:left; padding:4px 8px; border:1px solid #ddd; vertical-align:top; }
  table.meta th { width:280px; background:#f5f5f5; font-weight:600; }
  table.tbl { width:100%; border-collapse:collapse; font-size:11px; page-break-inside:auto; }
  table.tbl th, table.tbl td { border:1px solid #ddd; padding:4px 6px; text-align:left; vertical-align:top; }
  table.tbl thead { background:#f5f5f5; }
  table.tbl tr { page-break-inside:avoid; }
  .empty { padding:8px; text-align:center; color:#555; font-style:italic; }
  footer.doc { margin-top:24px; border-top:1px solid #ccc; padding-top:8px; font-size:10px; color:#666; text-align:center; }
  @media print { body { margin:0; } @page { margin:16mm; size:A4; } }
</style>
</head>
<body>
  <header class="doc">
    <!-- Bloque 1: Institucional -->
    <div class="inst-block">
      <div class="inst">Universidad Técnica de Ambato</div>
      <div class="sys">Sistema ServiceDesk UTA</div>
      <h1>Reporte individual de actividades del técnico</h1>
    </div>

    <!-- Bloque 2: Técnico -->
    <div class="section">
      <p class="sec-title">Información del técnico</p>
      <div class="row">
        <div class="field">
          <p class="label">Técnico:</p>
          <p class="value big">${esc(r.technician.name)}</p>
        </div>
        <div class="field">
          <p class="label">Área:</p>
          <p class="value">${esc(areaLabel)}</p>
        </div>
      </div>
    </div>

    <!-- Bloque 3: Período -->
    <div class="section">
      <p class="sec-title">Período del reporte</p>
      <div class="row">
        <div class="field">
          <p class="label">Período:</p>
          <p class="value">${esc(periodLabelSnapshot)}</p>
        </div>
        <div class="field">
          <p class="label">Desde:</p>
          <p class="value">${esc(r.range.from ? formatDay(r.range.from) : "—")}</p>
        </div>
        <div class="field">
          <p class="label">Hasta:</p>
          <p class="value">${esc(r.range.to ? formatDay(r.range.to) : "—")}</p>
        </div>
      </div>
    </div>

    <!-- Bloque 4: Generación -->
    <div class="section">
      <p class="sec-title">Información de generación</p>
      <div class="row">
        <div class="field">
          <p class="label">Generado por:</p>
          <p class="value">${esc(admin?.name ?? admin?.email ?? "Admin")}</p>
        </div>
        <div class="field">
          <p class="label">Fecha de generación:</p>
          <p class="value">${esc(generatedAtStr)}</p>
        </div>
      </div>
    </div>
  </header>

  <h2>Resumen general</h2>
  ${summaryHtml}

  <h2>Estadísticas por servicio</h2>
  ${svcStats}
  <h2>Estadísticas por estado</h2>
  ${statusStats}
  <h2>Estadísticas por prioridad</h2>
  ${priorityStats}

  <h2>Historial completo de tickets</h2>
  ${ticketsHtml}

  <h2>Actividad del técnico</h2>
  ${activityHtml}

  <h2>Reescalamientos</h2>
  ${escHtml}

  <h2>Resoluciones</h2>
  ${resHtml}

  <h2>Aportaciones</h2>
  ${contribHtml}

  <footer class="doc">
    Documento generado desde ServiceDesk UTA. Datos consultados en tiempo real desde ticket_db.
  </footer>
</body>
</html>`;
  }

  function openPrint() {
    if (!report) return;
    const win = window.open("", "_blank", "width=1000,height=800");
    if (!win) {
      setError("No se pudo abrir la ventana de impresión. Revisa el bloqueador de ventanas emergentes.");
      return;
    }
    win.document.open();
    win.document.write(buildPrintHtml());
    win.document.close();
    win.focus();
    win.onload = () => {
      win.print();
    };
    setTimeout(() => {
      try {
        win.print();
      } catch {
        /* ignore */
      }
    }, 400);
  }

  const areaLabel = selectedTech
    ? (selectedTech.areas.map(getResponsibleAreaLabel).join(" / ") ||
        getResponsibleAreaLabel(selectedTech.areas[0] ?? "TECHNICIANS"))
    : "—";

  return (
    <Layout>
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-uta-900">Reportes de Técnicos</h1>
          <p className="mt-1 text-sm text-gray-600">
            Reporte individual por técnico con datos reales del sistema.
          </p>
        </div>

        {/* Formulario de generación */}
        <div className="card mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Generar reporte
          </h2>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="label" htmlFor="tech-select">Seleccionar técnico</label>
              <select
                id="tech-select"
                className="input"
                value={selectedId}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setReport(null);
                }}
                disabled={loadingTechs || loadingReport}
              >
                <option value="">
                  {loadingTechs ? "Cargando técnicos…" : "— Seleccionar —"}
                </option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {getTechnicianDisplayLabel(t, { includeEmail: false })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="from">Desde</label>
              <input
                id="from"
                type="date"
                className="input"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  markCustom(e.target.value, dateTo);
                }}
                disabled={loadingReport}
              />
            </div>
            <div>
              <label className="label" htmlFor="to">Hasta</label>
              <input
                id="to"
                type="date"
                className="input"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  markCustom(dateFrom, e.target.value);
                }}
                disabled={loadingReport}
              />
            </div>
          </div>

          {/* Períodos institucionales UTA (opcional; configurables en INSTITUTIONAL_PERIODS) */}
          <div className="mt-3">
            <label className="label" htmlFor="uta-period">Período institucional UTA</label>
            <select
              id="uta-period"
              className="input max-w-md"
              value=""
              onChange={(e) => applyInstitutionalPeriod(e.target.value)}
              disabled={loadingReport}
            >
              <option value="">— Seleccionar período académico —</option>
              {INSTITUTIONAL_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={!selectedId || rangeInvalid || loadingReport}
              className="rounded bg-uta-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-uta-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {loadingReport ? "Generando…" : "Generar reporte"}
            </button>
            <button
              type="button"
              onClick={openPrint}
              disabled={!report}
              className="rounded border border-uta-700 bg-white px-4 py-1.5 text-sm font-semibold text-uta-700 hover:bg-uta-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              🖨 Imprimir
            </button>
            <button
              type="button"
              onClick={openPrint}
              disabled={!report}
              className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              title='En el diálogo elige "Guardar como PDF" como destino'
            >
              📄 Guardar PDF
            </button>
            <span className="ml-2 text-xs text-gray-500">Accesos rápidos:</span>
            <QuickBtn label="Todo" onClick={clearRange} disabled={loadingReport} />
            <QuickBtn label="Últimos 30 días" onClick={() => applyQuickRange(isoDay(-29), isoDay(0), PRESET_LABEL.LAST30)} disabled={loadingReport} />
            <QuickBtn label="Últimos 3 meses" onClick={() => applyQuickRange(isoMonths(3), isoDay(0), PRESET_LABEL.LAST3M)} disabled={loadingReport} />
            <QuickBtn label="Últimos 6 meses" onClick={() => applyQuickRange(isoMonths(6), isoDay(0), PRESET_LABEL.LAST6M)} disabled={loadingReport} />
            <QuickBtn label="Este año" onClick={() => applyQuickRange(isoYearStart(), isoDay(0), PRESET_LABEL.THIS_YEAR)} disabled={loadingReport} />
          </div>

          {/* Muestra el período que se aplicará al generar. */}
          <div className="mt-2 text-xs text-gray-500">
            Período seleccionado: <strong className="text-uta-900">{periodLabel}</strong>
          </div>
          {dateError && (
            <div className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {dateError}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loadingReport && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600" />
            <p className="text-sm text-gray-500">Generando reporte…</p>
          </div>
        )}

        {!loadingReport && report && (
          <div id="report-body">
            {/* Encabezado del reporte — organizado en 4 bloques jerárquicos */}
            <div className="card mb-6 overflow-hidden p-0">
              {/* Bloque 1: Institucional */}
              <div className="border-b-2 border-uta-700 bg-uta-50 px-6 py-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-uta-900">
                  Universidad Técnica de Ambato
                </p>
                <p className="mt-0.5 text-xs text-gray-600">Sistema ServiceDesk UTA</p>
                <h2 className="mt-2 text-lg font-bold uppercase tracking-wide text-uta-900">
                  Reporte individual de actividades del técnico
                </h2>
              </div>

              {/* Bloque 2: Técnico */}
              <section className="border-b border-gray-200 px-6 py-4">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                  Información del técnico
                </h3>
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-gray-500">Técnico</dt>
                    <dd className="text-xl font-bold text-uta-900">{report.technician.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Área</dt>
                    <dd className="text-base font-semibold text-gray-800">{areaLabel}</dd>
                  </div>
                </dl>
              </section>

              {/* Bloque 3: Período */}
              <section className="border-b border-gray-200 px-6 py-4">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                  Período del reporte
                </h3>
                <dl className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-gray-500">Período</dt>
                    <dd className="text-sm font-bold uppercase text-uta-900">
                      {periodLabelSnapshot}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Desde</dt>
                    <dd className="text-sm font-semibold text-gray-800">
                      {report.range.from ? formatDay(report.range.from) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Hasta</dt>
                    <dd className="text-sm font-semibold text-gray-800">
                      {report.range.to ? formatDay(report.range.to) : "—"}
                    </dd>
                  </div>
                </dl>
              </section>

              {/* Bloque 4: Generación */}
              <section className="px-6 py-4">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                  Información de generación
                </h3>
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-gray-500">Generado por</dt>
                    <dd className="text-sm font-semibold text-gray-800">
                      {admin?.name ?? admin?.email ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Fecha de generación</dt>
                    <dd className="text-sm font-semibold text-gray-800">
                      {formatDateTime(report.generatedAt)}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            {/* KPIs */}
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Resumen general
            </h2>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <Kpi label="Asignados" value={report.summary.ticketsAssigned} accent="bg-uta-100 text-uta-900" />
              <Kpi label="Aceptados" value={report.summary.ticketsAccepted} accent="bg-cyan-100 text-cyan-800" />
              <Kpi label="En proceso" value={report.summary.ticketsInProgress} accent="bg-amber-100 text-amber-800" />
              <Kpi label="Resueltos" value={report.summary.ticketsResolved} accent="bg-emerald-100 text-emerald-800" />
              <Kpi label="Cerrados" value={report.summary.ticketsClosed} accent="bg-gray-200 text-gray-800" />
              <Kpi label="Reescalados" value={report.summary.reescalations} accent="bg-orange-100 text-orange-800" />
              <Kpi label="Aportaciones" value={report.summary.contributions} accent="bg-blue-100 text-blue-800" />
              <Kpi label="Servicios" value={report.summary.distinctServices} accent="bg-slate-100 text-slate-800" />
            </div>

            {/* Gráficos */}
            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <DonutChart title="Tickets por estado" data={statusDonut} centerLabel="Tickets" />
              <DonutChart title="Tickets por prioridad" data={priorityDonut} centerLabel="Tickets" />
            </div>
            <div className="mb-6 grid gap-4 lg:grid-cols-1">
              <BarChart title="Tickets por servicio (top 10)" data={serviceBars} variant="horizontal" />
            </div>
            <div className="mb-6">
              <LineChart title="Tickets creados por mes" data={monthLine} />
            </div>

            {/* Historial completo */}
            <Section title={`Historial de tickets (${report.tickets.length})`}>
              {report.tickets.length === 0 ? (
                <EmptyRow msg="Sin tickets en el período seleccionado." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <Th>Número</Th><Th>Fecha</Th><Th>Servicio</Th><Th>Área</Th>
                        <Th>Prioridad</Th><Th>Estado</Th><Th>Solicitante</Th><Th>Resuelto</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {report.tickets.map((t) => (
                        <tr key={t.id} className="hover:bg-gray-50">
                          <Td mono>{t.number}</Td>
                          <Td>{formatDay(t.createdAt)}</Td>
                          <Td>{t.serviceName ?? "—"}</Td>
                          <Td>{getResponsibleAreaLabel(t.responsibleArea)}</Td>
                          <Td>{PRIORITY_LABEL[t.priority] ?? t.priority}</Td>
                          <Td>{STATUS_LABEL[t.status] ?? t.status}</Td>
                          <Td>{t.requesterName ?? "—"}</Td>
                          <Td>{t.resolvedAt ? formatDay(t.resolvedAt) : "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Actividad */}
            <Section title={`Actividad del técnico (${report.activity.length})`}>
              {report.activity.length === 0 ? (
                <EmptyRow msg="Sin actividad registrada." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <Th>Fecha</Th><Th>Ticket</Th><Th>Acción</Th><Th>Descripción</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {report.activity.map((a) => (
                        <tr key={a.id} className="hover:bg-gray-50">
                          <Td>{formatDay(a.createdAt)}</Td>
                          <Td mono>{a.ticketNumber ?? "—"}</Td>
                          <Td>{a.actionType}</Td>
                          <Td>{a.description ?? a.reason ?? a.workDone ?? "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Reescalamientos */}
            <Section title={`Reescalamientos (${report.escalations.length})`}>
              {report.escalations.length === 0 ? (
                <EmptyRow msg="Sin reescalamientos." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <Th>Ticket</Th><Th>Fecha</Th><Th>Área anterior</Th><Th>Área nueva</Th>
                        <Th>Motivo</Th><Th>Trabajo previo</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {report.escalations.map((e, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <Td mono>{e.ticketNumber ?? "—"}</Td>
                          <Td>{formatDay(e.createdAt)}</Td>
                          <Td>{e.previousArea ? getResponsibleAreaLabel(e.previousArea) : "—"}</Td>
                          <Td>{e.newArea ? getResponsibleAreaLabel(e.newArea) : "—"}</Td>
                          <Td>{e.reason ?? "—"}</Td>
                          <Td>{e.workDone ?? "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Resoluciones */}
            <Section title={`Resoluciones (${report.resolutions.length})`}>
              {report.resolutions.length === 0 ? (
                <EmptyRow msg="Sin resoluciones registradas." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <Th>Ticket</Th><Th>Servicio</Th><Th>Problema</Th><Th>Resuelto</Th><Th>Resumen</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {report.resolutions.map((x, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <Td mono>{x.ticketNumber}</Td>
                          <Td>{x.serviceName ?? "—"}</Td>
                          <Td>{x.problemDescription ?? "—"}</Td>
                          <Td>{x.resolvedAt ? formatDay(x.resolvedAt) : "—"}</Td>
                          <Td>{x.resolutionSummary ?? "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Aportaciones */}
            <Section title={`Aportaciones (${report.contributions.length})`}>
              {report.contributions.length === 0 ? (
                <EmptyRow msg="Sin aportaciones." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr><Th>Ticket</Th><Th>Fecha</Th><Th>Descripción</Th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {report.contributions.map((c, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <Td mono>{c.ticketNumber ?? "—"}</Td>
                          <Td>{formatDay(c.createdAt)}</Td>
                          <Td>{c.description ?? "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>
        )}
      </div>
    </Layout>
  );
}

// -----------------------------------------------------------------------------
// Sub-componentes chicos para no repetir clases
// -----------------------------------------------------------------------------
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
function QuickBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:border-uta-400 hover:text-uta-800 disabled:opacity-50"
    >
      {label}
    </button>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h2>
      <div className="card p-0">{children}</div>
    </div>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
      {children}
    </th>
  );
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td className={`px-4 py-3 text-gray-700 ${mono ? "font-mono font-semibold text-uta-900" : ""}`}>
      {children}
    </td>
  );
}
function EmptyRow({ msg }: { msg: string }) {
  return <p className="py-6 text-center text-sm text-gray-500">{msg}</p>;
}
