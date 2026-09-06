// Sprint 2 (rev) - Mapping rol -> áreas responsables que puede atender.
// Centraliza la regla de negocio en un solo lugar para no duplicar tablas.
// El mapping vive aquí (no en auth_db.users) porque es lógica de tickets,
// no del modelo de usuario.

import { ResponsibleArea } from "@prisma/client";

export type StaffRole = "admin" | "tech_n1" | "tech_n2" | "tech_n3" | "tech_n4";

const TECH_AREAS: Record<string, ResponsibleArea[]> = {
  // Técnicos básicos/profesionales: incidencias técnicas físicas y de red.
  tech_n1: [ResponsibleArea.TECHNICIANS],
  tech_n2: [ResponsibleArea.TECHNICIANS],
  // DTIC/especializado: plataformas y sistemas institucionales.
  tech_n3: [ResponsibleArea.DTIC],
  tech_n4: [ResponsibleArea.DTIC],
};

/**
 * Devuelve las áreas que un rol puede atender. Admin ve todas; usuario normal
 * ninguna; técnicos según su pista.
 */
export function areasForRole(role: string): ResponsibleArea[] {
  if (role === "admin") {
    return [ResponsibleArea.TECHNICIANS, ResponsibleArea.DTIC];
  }
  return TECH_AREAS[role] ?? [];
}

/** Helper rápido: ¿este rol puede atender tickets de esta área? */
export function canHandleArea(role: string, area: ResponsibleArea): boolean {
  return areasForRole(role).includes(area);
}

/** True si el rol es admin o técnico. */
export function isStaffRole(role: string | undefined): boolean {
  if (!role) return false;
  return role === "admin" || role.startsWith("tech_");
}
