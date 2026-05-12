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

// Servicios que requieren indicar ubicación física (daño a equipos, problemas en laboratorios/aulas)
const LOCATION_SERVICE_KEYWORDS = [
  "equipo",
  "hardware",
  "software",
  "internet",
  "conectividad",
];

// Sugerencias de ubicaciones dentro de la universidad
const LOCATION_SUGGESTIONS = [
  "Laboratorio 1 - FISEI",
  "Laboratorio 2 - FISEI",
  "Laboratorio 3 - FISEI",
  "Laboratorio 4 - FISEI",
  "Laboratorio de Redes - FISEI",
  "Laboratorio de Electrónica - FISEI",
  "Aula A1 - FISEI",
  "Aula A2 - FISEI",
  "Aula A3 - FISEI",
  "Aula B1 - FISEI",
  "Aula B2 - FISEI",
  "Sala de Docentes - FISEI",
  "Oficina de Decanato - FISEI",
  "Biblioteca - FISEI",
  "Centro de Cómputo General",
  "Otro (especificar en detalle)",
];

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Determina si un servicio requiere que el usuario indique ubicación física */
function requiresLocation(serviceName: string): boolean {
  const lower = serviceName.toLowerCase();
  return LOCATION_SERVICE_KEYWORDS.some((kw) => lower.includes(kw));
}

export default function NuevoTicket() {
  const user = getCurrentUser();

  const [services, setServices] = useState<CatalogService[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [serviceId, setServiceId] = useState<string>("");
  const [detail, setDetail] = useState("");
  const [location, setLocation] = useState("");
  const [customLocation, setCustomLocation] = useState("");

  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedTicket | null>(null);

  const today = useMemo(() => new Date().toLocaleDateString("es-EC", {
    year: "numeric", month: "long", day: "numeric",
  }), []);

  // El servicio actualmente seleccionado
  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId),
    [services, serviceId]
  );

  // ¿Mostrar el campo de ubicación?
  const showLocation = selectedService ? requiresLocation(selectedService.name) : false;

  useEffect(() => {
    api
      .get<{ services: CatalogService[] }>("/api/catalog/services")
      .then((r) => setServices(r.data.services))
      .catch((err) => setError(extractApiError(err)))
      .finally(() => setLoadingServices(false));
  }, []);

  // Resetear ubicación al cambiar de servicio
  useEffect(() => {
    if (!showLocation) {
      setLocation("");
      setCustomLocation("");
    }
  }, [showLocation]);

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

  function getEffectiveLocation(): string | undefined {
    if (!showLocation) return undefined;
    if (location.startsWith("Otro")) {
      return customLocation.trim() || undefined;
    }
    return location || undefined;
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
    if (showLocation && !getEffectiveLocation()) {
      setError("Indica la ubicación donde se presenta el problema.");
      return;
    }
    setSubmitting(true);
    const form = new FormData();
    form.append("serviceId", serviceId);
    form.append("detail", detail);
    const loc = getEffectiveLocation();
    if (loc) form.append("location", loc);
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
      setLocation("");
      setCustomLocation("");
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
              Número: <strong>{created.number}</strong> · Estado:{" "}
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
                  {s.name}
                </option>
              ))}
            </select>
            {selectedService?.description && (
              <p className="mt-2 text-xs text-gray-500">
                {selectedService.description}
              </p>
            )}
          </div>

          {/* Ubicación (condicional) */}
          {showLocation && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-3 transition-all duration-300">
              <div className="flex items-center gap-2 mb-1">
                <svg className="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <label className="block text-sm font-semibold text-amber-900" htmlFor="location">
                  Ubicación del problema
                </label>
              </div>
              <p className="text-xs text-amber-700">
                Indica el laboratorio, aula o lugar donde se presenta el problema.
              </p>
              <select
                id="location"
                className="input border-amber-300 focus:border-amber-500 focus:ring-amber-500/30"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={submitting}
                required
              >
                <option value="">Selecciona la ubicación</option>
                {LOCATION_SUGGESTIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
              {location.startsWith("Otro") && (
                <input
                  type="text"
                  className="input border-amber-300 focus:border-amber-500 focus:ring-amber-500/30"
                  placeholder="Escribe la ubicación exacta..."
                  value={customLocation}
                  onChange={(e) => setCustomLocation(e.target.value)}
                  disabled={submitting}
                  required
                  maxLength={255}
                />
              )}
            </div>
          )}

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
