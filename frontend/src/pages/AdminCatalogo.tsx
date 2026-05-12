import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";

type Level = "N1" | "N2" | "N3" | "N4";

interface CatalogService {
  id: string;
  name: string;
  description: string | null;
  levelEntry: Level;
  isActive: boolean;
  createdAt: string;
}

const LEVELS: Level[] = ["N1", "N2", "N3", "N4"];

const emptyForm = { name: "", description: "", levelEntry: "N1" as Level };

export default function AdminCatalogo() {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form de creación
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);

  // Form de edición (inline)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ services: CatalogService[] }>(
        "/api/catalog/services?includeInactive=true"
      );
      setServices(data.services);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createService(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api.post("/api/catalog/services", form);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(s: CatalogService) {
    setEditingId(s.id);
    setEditForm({
      name: s.name,
      description: s.description ?? "",
      levelEntry: s.levelEntry,
    });
  }

  async function saveEdit(id: string) {
    setError(null);
    try {
      await api.patch(`/api/catalog/services/${id}`, editForm);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  async function softDelete(id: string) {
    if (!confirm("¿Marcar como inactivo? No se eliminará del histórico de tickets.")) return;
    setError(null);
    try {
      await api.delete(`/api/catalog/services/${id}`);
      await load();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  async function reactivate(id: string) {
    setError(null);
    try {
      await api.patch(`/api/catalog/services/${id}`, { isActive: true });
      await load();
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  return (
    <Layout>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-uta-900">Catálogo de servicios</h1>
        <button onClick={load} className="btn-secondary" disabled={loading}>
          {loading ? "Cargando..." : "Refrescar"}
        </button>
      </div>

      {/* Formulario de creación */}
      <div className="card mb-6">
        <h2 className="mb-4 text-lg font-bold text-uta-900">Nuevo servicio</h2>
        <form onSubmit={createService} className="grid gap-4 sm:grid-cols-12">
          <div className="sm:col-span-4">
            <label className="label" htmlFor="new-name">Nombre</label>
            <input
              id="new-name"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="sm:col-span-5">
            <label className="label" htmlFor="new-desc">Descripción</label>
            <input
              id="new-desc"
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="new-level">Nivel</label>
            <select
              id="new-level"
              className="input"
              value={form.levelEntry}
              onChange={(e) => setForm({ ...form, levelEntry: e.target.value as Level })}
            >
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="sm:col-span-1 flex items-end">
            <button type="submit" className="btn-primary w-full" disabled={creating}>
              {creating ? "..." : "Crear"}
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-uta-300 bg-uta-100 px-4 py-3 text-sm font-medium text-uta-900">
          {error}
        </div>
      )}

      {/* Tabla */}
      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-uta-100 text-left text-xs font-semibold uppercase tracking-wide text-uta-900">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Descripción</th>
              <th className="px-4 py-3 text-center">Nivel</th>
              <th className="px-4 py-3 text-center">Estado</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-uta-100">
            {services.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-500">
                  Sin servicios registrados.
                </td>
              </tr>
            )}
            {services.map((s) => {
              const editing = editingId === s.id;
              return (
                <tr key={s.id} className={!s.isActive ? "bg-gray-50 text-gray-500" : ""}>
                  <td className="px-4 py-3 font-medium">
                    {editing ? (
                      <input
                        className="input"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                    ) : (
                      s.name
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editing ? (
                      <input
                        className="input"
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      />
                    ) : (
                      s.description ?? <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {editing ? (
                      <select
                        className="input"
                        value={editForm.levelEntry}
                        onChange={(e) => setEditForm({ ...editForm, levelEntry: e.target.value as Level })}
                      >
                        {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    ) : (
                      <span className="badge-level">{s.levelEntry}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {s.isActive ? (
                      <span className="badge-ok">activo</span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                        inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editing ? (
                      <div className="flex justify-end gap-2">
                        <button onClick={() => saveEdit(s.id)} className="btn-primary px-3 py-1 text-xs">
                          Guardar
                        </button>
                        <button onClick={() => setEditingId(null)} className="btn-secondary px-3 py-1 text-xs">
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button onClick={() => startEdit(s)} className="btn-secondary px-3 py-1 text-xs">
                          Editar
                        </button>
                        {s.isActive ? (
                          <button onClick={() => softDelete(s.id)} className="btn-secondary px-3 py-1 text-xs">
                            Desactivar
                          </button>
                        ) : (
                          <button onClick={() => reactivate(s.id)} className="btn-secondary px-3 py-1 text-xs">
                            Reactivar
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
