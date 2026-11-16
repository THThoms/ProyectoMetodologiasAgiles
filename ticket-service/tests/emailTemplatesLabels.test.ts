// Auditoría general: los correos al solicitante muestran etiquetas públicas de
// estado. El de "solución lista" sale con el ticket en `pendiente_validacion`;
// sin etiqueta, el correo mostraba el valor interno.
import { buildEmailTemplate } from "../src/services/emailTemplates";

describe("plantillas de correo · etiqueta del estado", () => {
  it("TICKET_RESOLVED con pendiente_validacion muestra 'Pendiente de validación'", () => {
    const tpl = buildEmailTemplate("TICKET_RESOLVED", {
      number: "TK-20261114-001",
      userName: "Persona Solicitante",
      serviceName: "Red e Internet",
      status: "pendiente_validacion",
      eventDate: new Date("2026-11-14T12:00:00Z"),
      knowledgeTitle: "Reinicio del punto de acceso",
    });
    expect(tpl.textBody).toContain("Pendiente de validación");
    expect(tpl.textBody).not.toContain("pendiente_validacion");
    expect(tpl.htmlBody).toContain("Pendiente de validación");
    expect(tpl.htmlBody).not.toContain("pendiente_validacion");
  });

  it("escapa HTML en los datos del ticket", () => {
    const tpl = buildEmailTemplate("TICKET_RESOLVED", {
      number: "TK-X",
      userName: "<img src=x onerror=alert(1)>",
      serviceName: "Red",
      status: "pendiente_validacion",
      knowledgeTitle: "<script>alert(1)</script>",
    });
    expect(tpl.htmlBody).not.toContain("<script>");
    expect(tpl.htmlBody).not.toContain("<img src=x");
    expect(tpl.htmlBody).toContain("&lt;script&gt;");
  });
});
