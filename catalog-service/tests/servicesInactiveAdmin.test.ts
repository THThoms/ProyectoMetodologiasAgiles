// Auditoría final — GET /services sigue siendo público (formulario de nuevo
// ticket), pero `includeInactive=true` (servicios dados de baja) exige un JWT
// de administrador.
import jwt from "jsonwebtoken";

jest.mock("../src/db/client", () => ({
  prisma: {
    service: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const token = (role: string) =>
  jwt.sign({ userId: "00000000-0000-4000-8000-000000000001", email: "u@uta.edu.ec", name: "T", role }, SECRET, {
    expiresIn: "1h",
  });

beforeEach(() => jest.clearAllMocks());

describe("GET /services · includeInactive", () => {
  it("sin el filtro es público y solo devuelve activos", async () => {
    (prisma.service.findMany as jest.Mock).mockResolvedValue([]);
    const res = await request(app).get("/services");
    expect(res.status).toBe(200);
    expect((prisma.service.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ isActive: true });
  });

  it("includeInactive=true sin JWT → 401", async () => {
    const res = await request(app).get("/services?includeInactive=true");
    expect(res.status).toBe(401);
    expect(prisma.service.findMany).not.toHaveBeenCalled();
  });

  it.each(["user", "technician", "dtic"])("includeInactive=true con rol %s → 403", async (role) => {
    const res = await request(app).get("/services?includeInactive=true").set("Authorization", `Bearer ${token(role)}`);
    expect(res.status).toBe(403);
    expect(prisma.service.findMany).not.toHaveBeenCalled();
  });

  it("includeInactive=true con administrador → 200 y consulta todos", async () => {
    (prisma.service.findMany as jest.Mock).mockResolvedValue([]);
    const res = await request(app).get("/services?includeInactive=true").set("Authorization", `Bearer ${token("admin")}`);
    expect(res.status).toBe(200);
    expect((prisma.service.findMany as jest.Mock).mock.calls[0][0].where).toEqual({});
  });
});
