import { PrismaClient, Role } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

// Hash simple para contraseñas de desarrollo (SHA-256).
// En producción real se usaría bcrypt o argon2.
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// Usuarios de prueba para desarrollo.
// En producción real, los usuarios se crean automáticamente al hacer SSO Microsoft.
// Cada usuario tiene una contraseña por defecto para el login local.
const seedUsers: Array<{ email: string; name: string; role: Role; password: string }> = [
  { email: "admin@uta.edu.ec",       name: "Administrador UTA",          role: Role.admin,   password: "admin123" },
  { email: "tecn1@uta.edu.ec",       name: "Técnico Nivel 1 (Básico)",   role: Role.tech_n1, password: "tecn1123" },
  { email: "tecn2@uta.edu.ec",       name: "Técnico Nivel 2 (Profes.)",  role: Role.tech_n2, password: "tecn2123" },
  { email: "tecn3@uta.edu.ec",       name: "Técnico Nivel 3 (DITIC)",    role: Role.tech_n3, password: "tecn3123" },
  { email: "tecn4@uta.edu.ec",       name: "Técnico Nivel 4 (Esp.)",     role: Role.tech_n4, password: "tecn4123" },
  { email: "docente@uta.edu.ec",     name: "Docente de Prueba",          role: Role.user,    password: "docente123" },
  { email: "estudiante@uta.edu.ec",  name: "Estudiante de Prueba",       role: Role.user,    password: "estudiante123" },
];

async function main() {
  for (const u of seedUsers) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, passwordHash: hashPassword(u.password) },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: hashPassword(u.password),
      },
    });
  }
  console.log(`Seed auth-service: ${seedUsers.length} usuarios de prueba listos (con contraseñas locales)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
