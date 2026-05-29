// HU-13 - Tests del flujo de login local (POST /auth/login):
//   - login correcto genera JWT y no expone passwordHash
//   - login incorrecto devuelve mensaje genérico (no revela correo vs password)
//   - hash legacy SHA-256 se migra a bcrypt tras login correcto
//   - usuario Microsoft sin passwordHash no permite login local (sin romper SSO)

import crypto from "crypto";

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockSessionCreate = jest.fn();
const mockAuthLogCreate = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      update: (...a: unknown[]) => mockUserUpdate(...a),
    },
    session: { create: (...a: unknown[]) => mockSessionCreate(...a) },
    authLog: { create: (...a: unknown[]) => mockAuthLogCreate(...a) },
  },
}));

import request from "supertest";
import { createApp } from "../src/app";
import { hashPassword } from "../src/utils/passwordSecurity";

const app = createApp();
const VALID = "Servic3#Desk";
const USER_ID = "11111111-1111-4111-8111-aaaaaaaaaaaa";

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "docente@uta.edu.ec",
    name: "Docente de Prueba",
    role: "user",
    microsoftId: null,
    passwordHash: hashPassword(VALID),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionCreate.mockResolvedValue({ id: "sess" });
  mockAuthLogCreate.mockResolvedValue({ id: "log" });
  mockUserUpdate.mockResolvedValue({ id: USER_ID });
});

describe("POST /auth/login", () => {
  it("login correcto genera JWT y NO devuelve passwordHash", async () => {
    mockUserFindUnique.mockResolvedValue(baseUser());
    const res = await request(app)
      .post("/auth/login")
      .send({ correo: "docente@uta.edu.ec", password: VALID });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(20);
    // No se filtra el hash en ningún punto de la respuesta.
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(res.body.user).not.toHaveProperty("passwordHash");
  });

  it("contraseña incorrecta devuelve 401 con mensaje genérico", async () => {
    mockUserFindUnique.mockResolvedValue(baseUser());
    const res = await request(app)
      .post("/auth/login")
      .send({ correo: "docente@uta.edu.ec", password: "Mala#Clave9" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Credenciales inválidas");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("correo inexistente devuelve el MISMO mensaje genérico (no revela cuál falló)", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/auth/login")
      .send({ correo: "nadie@uta.edu.ec", password: VALID });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Credenciales inválidas");
  });

  it("migra hash legacy SHA-256 a bcrypt tras login correcto", async () => {
    const legacyHash = crypto.createHash("sha256").update(VALID).digest("hex");
    mockUserFindUnique.mockResolvedValue(baseUser({ passwordHash: legacyHash }));

    const res = await request(app)
      .post("/auth/login")
      .send({ correo: "docente@uta.edu.ec", password: VALID });

    expect(res.status).toBe(200);
    // Debe re-hashear: update con un passwordHash bcrypt ($2...).
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockUserUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: USER_ID });
    expect(typeof updateArg.data.passwordHash).toBe("string");
    expect(updateArg.data.passwordHash.startsWith("$2")).toBe(true);
    expect(updateArg.data.passwordHash).not.toBe(legacyHash);
  });

  it("usuario Microsoft sin passwordHash no permite login local (genérico)", async () => {
    mockUserFindUnique.mockResolvedValue(
      baseUser({ passwordHash: null, microsoftId: "ms-oid-123" })
    );
    const res = await request(app)
      .post("/auth/login")
      .send({ correo: "docente@uta.edu.ec", password: VALID });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Credenciales inválidas");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("400 si faltan credenciales", async () => {
    const res = await request(app).post("/auth/login").send({ correo: "docente@uta.edu.ec" });
    expect(res.status).toBe(400);
  });
});
