// Auditoría general — endurecimiento de auth-service:
//   · un error asíncrono de una ruta responde 500 (antes tumbaba el proceso);
//   · el limitador de intentos no crece con entradas del atacante;
//   · JWT con algoritmo fijado y sin tokens internos como sesión de usuario;
//   · directorio interno de técnicos solo con token de servicio;
//   · código SSO de Android ligado a un verificador (tipo PKCE);
//   · token de Microsoft emitido por otro tenant → rechazado;
//   · los registros no guardan códigos de autorización.
import crypto from "crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import type { Express } from "express";

const mockUserFindUnique = jest.fn();
const mockUserFindMany = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserCreate = jest.fn();
const mockSessionCreate = jest.fn();
const mockSessionFindUnique = jest.fn();
const mockAuthLogCreate = jest.fn();
const mockAcquireToken = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      findMany: (...a: unknown[]) => mockUserFindMany(...a),
      update: (...a: unknown[]) => mockUserUpdate(...a),
      create: (...a: unknown[]) => mockUserCreate(...a),
    },
    session: {
      create: (...a: unknown[]) => mockSessionCreate(...a),
      findUnique: (...a: unknown[]) => mockSessionFindUnique(...a),
    },
    authLog: { create: (...a: unknown[]) => mockAuthLogCreate(...a) },
  },
}));

jest.mock("../src/config/msal.config", () => ({
  SCOPES: ["openid", "profile", "email"],
  getMsalClient: () => ({
    getAuthCodeUrl: async (r: { state?: string }) =>
      `https://login.microsoftonline.com/fake?state=${encodeURIComponent(r.state ?? "")}`,
    acquireTokenByCode: (...a: unknown[]) => mockAcquireToken(...a),
  }),
}));

const TENANT = "11111111-2222-4333-8444-555555555555";
const SECRET = process.env.JWT_SECRET!;
const USER = {
  id: "33333333-3333-4333-8333-cccccccccccc",
  email: "tecnico.persona@uta.edu.ec",
  name: "Persona Técnica",
  role: "technician",
  block: "BLOQUE_1",
};
const ORIGINAL_ENV = { ...process.env };

let app: Express;
let limiterModule: typeof import("../src/security/loginRateLimiter");
let jwtModule: typeof import("../src/utils/jwt");

beforeAll(() => {
  process.env = {
    ...ORIGINAL_ENV,
    MICROSOFT_CLIENT_ID: "cid",
    MICROSOFT_TENANT_ID: TENANT,
    MICROSOFT_CLIENT_SECRET: "x",
    MICROSOFT_REDIRECT_URI: "https://sd.example/api/auth/microsoft/callback",
    FRONTEND_URL: "https://sd.example",
  };
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    app = require("../src/app").createApp();
    limiterModule = require("../src/security/loginRateLimiter");
    jwtModule = require("../src/utils/jwt");
    /* eslint-enable @typescript-eslint/no-var-requires */
  });
});
afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks();
  const l = limiterModule.loginLimiter as unknown as { ips: Map<string, unknown>; accounts: Map<string, unknown> };
  l.ips.clear();
  l.accounts.clear();
  mockUserFindUnique.mockResolvedValue(USER);
  mockUserUpdate.mockResolvedValue(USER);
  mockSessionCreate.mockResolvedValue({});
  mockAuthLogCreate.mockResolvedValue({});
  mockAcquireToken.mockResolvedValue({
    idTokenClaims: { tid: TENANT, oid: "oid-1", email: USER.email, name: USER.name },
  });
});

const serviceToken = (over: Record<string, unknown> = {}, opts: jwt.SignOptions = {}) =>
  jwt.sign({ typ: "service", svc: "ticket-service", ...over }, SECRET, {
    algorithm: "HS256",
    audience: "servicedesk-internal",
    expiresIn: 60,
    ...opts,
  });

describe("errores asíncronos en rutas", () => {
  it("una consulta que falla responde 500 JSON y no deja la petición colgada", async () => {
    const token = jwtModule.signAuthToken({ userId: USER.id, email: USER.email, name: USER.name, role: "technician" });
    mockSessionFindUnique.mockResolvedValue({
      tokenHash: jwtModule.hashToken(token),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockUserFindUnique.mockRejectedValue(new Error("base de datos no disponible"));
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    err.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Error interno del servidor" });
  });
});

describe("limitador de intentos: memoria acotada", () => {
  it("consultar no crea entradas; solo los fallos reales ocupan memoria", () => {
    const l = new limiterModule.LoginRateLimiter();
    for (let i = 0; i < 1000; i++) l.check(`10.0.${i % 250}.${i % 200}`, `cuenta${i}@uta.edu.ec`);
    expect(l.size()).toEqual({ ips: 0, accounts: 0 });
    l.recordFailure("10.0.0.1", "alguien@uta.edu.ec");
    expect(l.size()).toEqual({ ips: 1, accounts: 1 });
  });

  it("el número de claves tiene tope aunque se prueben miles de cuentas", () => {
    const l = new limiterModule.LoginRateLimiter({ ...limiterModule.DEFAULT_RATE_LIMIT, maxFailuresPerIp: 1e9, maxEntries: 50 });
    for (let i = 0; i < 500; i++) l.recordFailure("10.0.0.1", `cuenta${i}@uta.edu.ec`);
    expect(l.size().accounts).toBeLessThanOrEqual(50);
  });

  it("una clave gigante se recorta: no se guardan 100 kB por intento", () => {
    const l = new limiterModule.LoginRateLimiter();
    const huge = "a".repeat(90_000) + "@uta.edu.ec";
    l.recordFailure("10.0.0.1", huge);
    const keys = [...(l as unknown as { accounts: Map<string, unknown> }).accounts.keys()];
    expect(keys[0].length).toBeLessThanOrEqual(320);
  });

  it("login con un correo desproporcionado → 401 genérico sin tocar base de datos ni limitador", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ correo: "a".repeat(5000) + "@uta.edu.ec", password: "x" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Credenciales inválidas");
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(limiterModule.loginLimiter.size()).toEqual({ ips: 0, accounts: 0 });
  });

  it("un cuerpo mayor de 32 kB se rechaza", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ correo: "a@uta.edu.ec", password: "x".repeat(40_000) });
    expect(res.status).toBe(413);
  });
});

describe("JWT de sesión", () => {
  it("rechaza un token sin firma (alg none) y uno con otro algoritmo", () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({ userId: USER.id, role: "admin" })}.`;
    expect(() => jwtModule.verifyAuthToken(unsigned)).toThrow();
    const hs512 = jwt.sign({ userId: USER.id, role: "admin" }, SECRET, { algorithm: "HS512" });
    expect(() => jwtModule.verifyAuthToken(hs512)).toThrow();
  });

  it("un token interno de servicio no vale como sesión de usuario", async () => {
    expect(() => jwtModule.verifyAuthToken(serviceToken())).toThrow();
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${serviceToken()}`);
    expect(res.status).toBe(401);
  });
});

describe("GET /auth/internal/technicians (servicio a servicio)", () => {
  beforeEach(() => {
    mockUserFindMany.mockResolvedValue([
      { id: USER.id, role: "technician", block: "BLOQUE_1" },
      { id: "44444444-4444-4444-8444-dddddddddddd", role: "tech_n3", block: "BLOQUE_2" },
    ]);
  });

  it("sin token, con token de usuario o con token ajeno → 401", async () => {
    expect((await request(app).get("/auth/internal/technicians")).status).toBe(401);
    const userToken = jwtModule.signAuthToken({ userId: USER.id, email: USER.email, name: USER.name, role: "admin" });
    expect(
      (await request(app).get("/auth/internal/technicians").set("Authorization", `Bearer ${userToken}`)).status
    ).toBe(401);
    for (const bad of [
      serviceToken({ svc: "otro-servicio" }),
      serviceToken({ typ: "user" }),
      serviceToken({ userId: USER.id }),
      serviceToken({}, { audience: "otra-audiencia" }),
      jwt.sign({ typ: "service", svc: "ticket-service" }, "otro-secreto-de-al-menos-32-caracteres", {
        audience: "servicedesk-internal",
      }),
    ]) {
      expect((await request(app).get("/auth/internal/technicians").set("Authorization", `Bearer ${bad}`)).status).toBe(401);
    }
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it("con token de servicio devuelve id, rol oficial y bloque, sin nombres ni correos", async () => {
    const res = await request(app).get("/auth/internal/technicians").set("Authorization", `Bearer ${serviceToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.technicians).toEqual([
      { id: USER.id, role: "technician", block: "BLOQUE_1", isActive: true },
      { id: "44444444-4444-4444-8444-dddddddddddd", role: "dtic", block: null, isActive: true },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/@|name|email/);
    expect(mockUserFindMany.mock.calls[0][0].select).toEqual({ id: true, role: true, block: true });
  });
});

// ---------------------------------------------------------------------------
// SSO
// ---------------------------------------------------------------------------
const cookiesOf = (res: request.Response) => ([] as string[]).concat(res.headers["set-cookie"] ?? []);
const cookieHeader = (res: request.Response) =>
  cookiesOf(res)
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ");
const newVerifier = () => crypto.randomBytes(32).toString("base64url");
const challengeOf = (v: string) => crypto.createHash("sha256").update(v, "utf8").digest("base64url");

async function androidLogin(challenge?: string) {
  const start = await request(app).get(`/auth/microsoft?client=android${challenge ? `&cc=${challenge}` : ""}`);
  const state = new URL(start.headers.location as string).searchParams.get("state")!;
  const cb = await request(app)
    .get(`/auth/microsoft/callback?code=ms-auth-code&state=${encodeURIComponent(state)}`)
    .set("Cookie", cookieHeader(start));
  return { start, cb, code: new URL(cb.headers.location as string).searchParams.get("code") };
}

describe("SSO en Android: el código queda ligado a quien inició el login", () => {
  it("el reto viaja en una cookie HttpOnly y el callback la borra", async () => {
    const challenge = challengeOf(newVerifier());
    const { start, cb } = await androidLogin(challenge);
    const cc = cookiesOf(start).find((c) => c.startsWith("sd_oauth_cc="))!;
    expect(cc).toMatch(new RegExp(`^sd_oauth_cc=${challenge}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$`));
    expect(cookiesOf(cb).some((c) => /^sd_oauth_cc=; .*Max-Age=0/.test(c))).toBe(true);
  });

  it("quien intercepta el enlace no puede canjear el código sin el verificador", async () => {
    const verifier = newVerifier();
    const { code } = await androidLogin(challengeOf(verifier));
    const stolen = await request(app).post("/auth/sso/exchange").send({ code });
    expect(stolen.status).toBe(400);
    expect(stolen.body.token).toBeUndefined();
    expect(mockSessionCreate).not.toHaveBeenCalled();
    // El código quedó consumido: ni siquiera con el verificador se reutiliza.
    expect((await request(app).post("/auth/sso/exchange").send({ code, verifier })).status).toBe(400);
  });

  it("un verificador equivocado se rechaza; el correcto obtiene la sesión", async () => {
    const verifier = newVerifier();
    const wrong = await androidLogin(challengeOf(verifier));
    expect((await request(app).post("/auth/sso/exchange").send({ code: wrong.code, verifier: newVerifier() })).status).toBe(400);

    const good = await androidLogin(challengeOf(verifier));
    const res = await request(app).post("/auth/sso/exchange").send({ code: good.code, verifier });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^eyJ/);
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
  });

  it("un reto mal formado se ignora y una app antigua (sin reto) sigue entrando", async () => {
    const malformed = await request(app).get("/auth/microsoft?client=android&cc=no-es-un-reto");
    expect(cookiesOf(malformed).some((c) => /^sd_oauth_cc=[A-Za-z0-9_-]{43};/.test(c))).toBe(false);
    const legacy = await androidLogin();
    expect((await request(app).post("/auth/sso/exchange").send({ code: legacy.code })).status).toBe(200);
  });

  it("el flujo web no acepta un reto ajeno: no se guarda ninguna cookie de reto", async () => {
    const res = await request(app).get(`/auth/microsoft?cc=${challengeOf(newVerifier())}`);
    expect(cookiesOf(res).some((c) => /^sd_oauth_cc=[A-Za-z0-9_-]{43};/.test(c))).toBe(false);
  });
});

describe("tenant de Microsoft", () => {
  it("un token emitido por OTRO tenant no inicia sesión aunque el correo sea institucional", async () => {
    mockAcquireToken.mockResolvedValue({
      idTokenClaims: { tid: "99999999-9999-4999-8999-999999999999", oid: "x", email: "admin@uta.edu.ec", name: "Impostor" },
    });
    const start = await request(app).get("/auth/microsoft");
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    const cb = await request(app)
      .get(`/auth/microsoft/callback?code=c&state=${encodeURIComponent(state)}`)
      .set("Cookie", cookieHeader(start));
    expect(cb.headers.location).toBe("https://sd.example/login?error=auth_failed");
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("MICROSOFT_TENANT_ID multi-tenant (common/organizations/consumers) desactiva el SSO", () => {
    for (const tenant of ["common", "Organizations", "consumers"]) {
      jest.isolateModules(() => {
        const saved = process.env.MICROSOFT_TENANT_ID;
        process.env.MICROSOFT_TENANT_ID = tenant;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { env } = require("../src/config/env");
        process.env.MICROSOFT_TENANT_ID = saved;
        expect(env.ssoConfigured).toBe(false);
        expect(env.ssoTenantRejected).toBe(true);
      });
    }
  });
});

describe("configuración", () => {
  it("en producción un JWT_SECRET de menos de 32 caracteres impide arrancar", () => {
    jest.isolateModules(() => {
      const saved = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET };
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "corto";
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      expect(() => require("../src/config/env")).toThrow(/32 caracteres/);
      process.env.NODE_ENV = saved.NODE_ENV;
      process.env.JWT_SECRET = saved.JWT_SECRET;
    });
  });
});

describe("registro de accesos", () => {
  it("no guarda el código de autorización ni el state de la URL", async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    await request(app).get("/auth/microsoft/callback?code=CODIGO-SECRETO-123&state=web.ESTADO-SECRETO");
    spy.mockRestore();
    const log = lines.join("");
    expect(log).toContain("code=[REDACTADO]");
    expect(log).toContain("state=[REDACTADO]");
    expect(log).not.toContain("CODIGO-SECRETO-123");
    expect(log).not.toContain("ESTADO-SECRETO");
  });
});

// Auditoría general: /auth/users/lookup solo consulta identificadores UUID. Un
// valor arbitrario hacía fallar la conversión a uniqueidentifier en SQL Server
// y la petición completa respondía 500.
describe("POST /auth/users/lookup · identificadores", () => {
  const staffToken = () =>
    jwt.sign({ userId: USER.id, email: USER.email, name: USER.name, role: "admin" }, SECRET, {
      expiresIn: "1h",
      jwtid: crypto.randomUUID(),
    });

  it("descarta los ids que no son UUID y consulta solo los válidos", async () => {
    mockSessionFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    mockUserFindMany.mockResolvedValue([USER]);
    const res = await request(app)
      .post("/auth/users/lookup")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ ids: [USER.id, "no-es-uuid", "x OR 1=1 --", 42, null] });
    expect(res.status).toBe(200);
    expect(mockUserFindMany).toHaveBeenCalledTimes(1);
    const where = mockUserFindMany.mock.calls[0][0].where;
    expect(where.id.in).toEqual([USER.id]);
    expect(res.body.users).toHaveLength(1);
  });

  it("sin ningún UUID válido responde la lista vacía", async () => {
    mockSessionFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    mockUserFindMany.mockResolvedValue([]);
    const res = await request(app)
      .post("/auth/users/lookup")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ ids: ["x", "y"] });
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([]);
  });
});
