// Auditoría general — endurecimiento del API Gateway.
import request from "supertest";
import { createApp } from "../src/app";
import { redactUrl } from "../src/logging/redact";

const app = createApp();

describe("rutas internas entre microservicios", () => {
  it.each([
    "/api/auth/internal/technicians",
    "/auth/internal/technicians",
    "/API/AUTH/INTERNAL/technicians",
    "/api/auth/internal",
  ])("%s no se publica: 404 sin llegar a auth-service", async (url) => {
    const res = await request(app).get(url).set("Authorization", "Bearer cualquier-cosa");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Ruta no encontrada en el gateway" });
  });
});

describe("CORS", () => {
  it("un origen no permitido recibe 403 JSON, sin traza de pila", async () => {
    const res = await request(app).get("/health").set("Origin", "https://sitio-ajeno.example");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Origen no permitido" });
    expect(res.text).not.toMatch(/at .*\.(ts|js):\d+/);
  });

  it("el origen del frontend, el de la app Android y las peticiones sin Origin pasan", async () => {
    for (const origin of [process.env.FRONTEND_URL ?? "http://localhost:3000", "https://localhost"]) {
      const res = await request(app).get("/health").set("Origin", origin);
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    }
    expect((await request(app).get("/health")).status).toBe(200);
  });
});

describe("registros", () => {
  it("redactUrl oculta códigos, state y tokens, y conserva el resto", () => {
    expect(redactUrl("/auth/callback?code=ABC123&state=web.XYZ&session_state=s1")).toBe(
      "/auth/callback?code=[REDACTADO]&state=[REDACTADO]&session_state=[REDACTADO]"
    );
    expect(redactUrl("/api/tickets/my?status=abierto&page=2")).toBe("/api/tickets/my?status=abierto&page=2");
    expect(redactUrl("/x?a=1&TOKEN=eyJhbGciOi.zzz#frag")).toBe("/x?a=1&TOKEN=[REDACTADO]#frag");
    expect(redactUrl("/api/auth/microsoft?client=android&login_hint=u%40uta.edu.ec")).toBe(
      "/api/auth/microsoft?client=android&login_hint=u%40uta.edu.ec"
    );
  });

  it("el registro de accesos del gateway no guarda el código del callback", async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    await request(app).get("/ruta-inexistente?code=CODIGO-SECRETO-999&state=web.ESTADO");
    spy.mockRestore();
    const log = lines.join("");
    expect(log).toContain("code=[REDACTADO]");
    expect(log).not.toContain("CODIGO-SECRETO-999");
  });
});
