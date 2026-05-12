import { useEffect, useMemo, useRef, useState } from "react";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";
import { getCurrentUser } from "../lib/auth";

interface CatalogService {
  id: string;
  name: string;
  description: string | null;
  levelEntry: "N1" | "N2" | "N3" | "N4";
  isActive: boolean;
}

interface CreatedTicket {
  id: string;
  number: string;
  status: string;
  levelAssigned: string;
}

const MAX_FILES = 5;
const MAX_SIZE_MB = 5;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/jpg"];

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function NuevoTicket() {
  const user = getCurrentUser();

  const [services, setServices] = useState<CatalogService[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [serviceId, setServiceId] = useState<string>("");
  const [detail, setDetail] = useState("");

  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedTicket | null>(null);

  const today = useMemo(() => new Date().toLocaleDateString("es-EC", {
    year: "numeric", month: "long", day: "numeric",
  }), []);

  useEffect(() => {
    api
      .get<{ services: CatalogService[] }>("/api/catalog/services")
      .then((r) => setServices(r.data.services))
      .catch((err) => setError(extractApiError(err)))
      .finally(() => setLoadingServices(false));
  }, []);

  function addFiles(incoming: FileList | File[]) {
    setError(null);
    const arr = Array.from(incoming);
    const merged = [...files];
    for (const f of arr) {
      if (merged.length >= MAX_FILES) {
        setError(`Máximo ${MAX_FILES} imágenes por ticket.`);
        break;
      }
      if (!ACCEPTED.includes(f.type)) {
        setError(`"${f.name}" no es JPG/PNG.`);
        continue;
      }
      if (f.size > MAX_SIZE_BYTES) {
        setError(`"${f.name}" supera los ${MAX_SIZE_MB} MB.`);
        continue;
      }
      // Evitar duplicados por nombre+tamaño
      if (merged.some((x) => x.name === f.name && x.size === f.size)) continue;
      merged.push(f);
    }
    setFiles(merged);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!serviceId) {
      setError("Selecciona el servicio afectado.");
      return;
    }
    if (detail.trim().length < 5) {
      setError("El detalle debe tener al menos 5 caracteres.");
      return;
    }
    setSubmitting(true);
    const form = new FormData();
    form.append("serviceId", serviceId);
    form.append("detail", detail);
    for (const f of files) form.append("attachments", f);
    try {
      const { data } = await api.post<{ ticket: CreatedTicket }>(
        "/api/tickets",
        form,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setCreated(data.ticket);
      // Reset
      setDetail("");
      setServiceId("");
      setFiles([]);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-2xl font-bold text-uta-900">Nuevo Ticket</h1>
          <p className="text-sm text-gray-600">{today}</p>
        </div>

        {/* Cabecera con info del usuario */}
        <div className="card mb-6">
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="label">Solicitante</p>
              <p className="font-medium text-gray-900">{user?.name}</p>
              <p className="text-xs text-gray-500">{user?.email}</p>
            </div>
            <div>
              <p className="label">Estado inicial</p>
              <span className="badge-ok">abierto</span>
            </div>
          </div>
        </div>

        {created && (
          <div className="card mb-6 border-ok-50 bg-ok-50/40">
            <h2 className="mb-2 text-lg font-bold text-ok-900">¡Ticket creado!</h2>
            <p className="text-sm text-gray-700">
              Número: <strong>{created.number}</strong> · Nivel asignado:{" "}
              <span className="badge-level">{created.levelAssigned}</span> · Estado:{" "}
              <span className="badge-ok">{created.status}</span>
            </p>
            <p className="mt-2 text-xs text-gray-600">
              Será atendido por el equipo técnico correspondiente.
            </p>
          </div>
        )}

        <form onSubmit={submit} className="card space-y-5">
          {/* Servicio */}
          <div>
            <label className="label" htmlFor="service">Servicio afectado</label>
            <select
              id="service"
              className="input"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              disabled={loadingServices || submitting}
              required
            >
              <option value="">
                {loadingServices ? "Cargando servicios..." : "Selecciona un servicio"}
              </option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · Nivel inicial {s.levelEntry}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-gray-500">
              El ticket será asignado automáticamente al nivel técnico según el servicio seleccionado.
            </p>
          </div>

          {/* Detalle */}
          <div>
            <label className="label" htmlFor="detail">Detalle del problema</label>
            <textarea
              id="detail"
              rows={6}
              className="input"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Describe el problema con el mayor detalle posible..."
              disabled={submitting}
              required
            />
          </div>

          {/* Drag & drop */}
          <div>
            <label className="label">Adjuntar imágenes (opcional)</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-8 text-center transition ${
                dragOver
                  ? "border-uta-500 bg-uta-100"
                  : "border-uta-300 bg-uta-50 hover:bg-uta-100"
              }`}
            >
              <svg className="mb-2 h-10 w-10 text-uta-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.9 5 5 0 019.9-1A5 5 0 0117 16m-7-3l3-3m0 0l3 3m-3-3v9" />
              </svg>
              <p className="text-sm font-medium text-uta-900">
                Arrastra imágenes aquí o haz clic para seleccionar
              </p>
              <p className="text-xs text-gray-500">
                Hasta {MAX_FILES} archivos JPG/PNG · máx {MAX_SIZE_MB} MB c/u
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/jpg"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
            </div>

            {/* Previews */}
            {files.length > 0 && (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-md border border-uta-100 bg-white p-2">
                    <img
                      src={URL.createObjectURL(f)}
                      alt={f.name}
                      className="h-14 w-14 rounded object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{f.name}</p>
                      <p className="text-xs text-gray-500">{humanSize(f.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="text-sm font-medium text-uta-700 hover:text-uta-500"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-uta-300 bg-uta-100 px-4 py-3 text-sm font-medium text-uta-900">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Enviando..." : "ENVIAR TICKET"}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
