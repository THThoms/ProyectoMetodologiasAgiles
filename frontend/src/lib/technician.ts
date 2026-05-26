// Helper único de presentación de técnicos en la UI.
//
// El flujo del Sprint 2 modificado funciona por ÁREA RESPONSABLE; los niveles
// N1-N4 y los roles internos (`tech_n1..n4`) son detalle de implementación y
// NUNCA deben aparecer en pantalla. El backend sigue usándolos para mapear
// rol → áreas (areaService.ts), pero el cliente solo muestra "Técnico" + área.
//
// Reglas de visualización:
//   1. El "nombre" visible base es siempre la palabra "Técnico" (no usar
//      technician.name porque el seed lo trae con "Nivel/Básico/DITIC/Esp.").
//   2. El área sale de `technician.areas[]`:
//        TECHNICIANS -> "Técnicos"
//        TICS        -> "TICs"
//        GENERAL     -> "General" (solo si no hay otra área específica).
//   3. Si el técnico cubre TECHNICIANS+GENERAL muestra "Técnicos".
//   4. Si el técnico cubre TICS+GENERAL muestra "TICs".
//   5. Email opcional como desambiguador.

export interface TechnicianRef {
  id: string;
  name?: string;
  email?: string;
  /** Áreas que cubre el técnico, derivadas en el backend desde el rol. */
  areas?: string[];
  /** No usar en UI: rol interno (tech_n1..n4 / admin). */
  role?: string;
}

export function getTechnicianAreaLabel(technician: TechnicianRef): string {
  const areas = technician.areas ?? [];
  if (areas.includes("TICS")) return "TICs";
  if (areas.includes("TECHNICIANS")) return "Técnicos";
  if (areas.includes("GENERAL")) return "General";
  return "Sin área";
}

/**
 * Etiqueta para mostrar en selects/dropdowns. Formato:
 *   "Técnico — <área>"                        (sin email)
 *   "Técnico — <área> — <email>"              (con email para desambiguar)
 *
 * Nunca expone technician.role ni el technician.name crudo del seed.
 */
export function getTechnicianDisplayLabel(
  technician: TechnicianRef,
  options: { includeEmail?: boolean } = { includeEmail: true }
): string {
  const area = getTechnicianAreaLabel(technician);
  const base = `Técnico — ${area}`;
  if (options.includeEmail && technician.email) {
    return `${base} — ${technician.email}`;
  }
  return base;
}
