// Rutas internas que la app puede abrir desde fuera (notificación push, enlace).
//
// Una notificación trae `deepLink` o `ticketId` en sus datos. Aunque las envía el
// propio backend a través de Firebase, la app solo navega a rutas de la SPA:
// nunca a otro origen ("https://…", "//host", "\\host") ni a un esquema. Un
// router que acepte "//" o "\\" como destino abriría un sitio ajeno con la
// sesión del usuario a la vista (redirección abierta).
//
// Módulo sin dependencias de Capacitor para poder probarlo con `node --test`.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ruta interna válida ("/tickets/…", "/mis-tickets?x=1") o null. */
export function safeInternalPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/\s/.test(value) || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return null;
  return value;
}

/** Destino de una notificación: `deepLink` interno o, si no, el ticket indicado. */
export function deepLinkFor(data: Record<string, unknown> | undefined | null): string | null {
  const explicit = safeInternalPath(data?.deepLink);
  if (explicit) return explicit;
  const ticketId = data?.ticketId;
  return typeof ticketId === "string" && UUID_RE.test(ticketId) ? `/tickets/${ticketId}` : null;
}
