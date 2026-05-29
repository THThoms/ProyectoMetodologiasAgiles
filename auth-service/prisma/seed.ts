import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// El seed se ejecuta con ts-node en el contenedor de producción, que solo
// incluye `dist/` y `prisma/` (no `src/`). Por eso NO importamos el helper
// de src/utils/passwordSecurity y replicamos aquí el hashing con bcryptjs
// (misma config: 12 salt rounds). El helper sigue siendo la fuente única para
// el código de la aplicación; esta es la única duplicación intencional.
const BCRYPT_ROUNDS = 12;
function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

// =============================================================================
// HU-13 - NOTA DE SEGURIDAD:
// Las contraseñas de abajo son SOLO para entorno de desarrollo local. Son
// credenciales conocidas para facilitar las pruebas del equipo y NO cumplen la
// política de contraseñas seguras (validatePasswordPolicy) a propósito: la
// política se aplica a operaciones vía API (creación / cambio de contraseña),
// no al seed de desarrollo. En producción los usuarios se crean por SSO
// Microsoft (sin contraseña local). Nunca se imprimen estas contraseñas en logs
// y siempre se almacenan hasheadas con bcrypt vía hashPassword().
// =============================================================================
const seedUsers: Array<{ email: string; name: string; role: Role; password: string }> = [
  { email: "admin@uta.edu.ec",       name: "Administrador UTA",          role: Role.admin,   password: "admin123" },
  { email: "msolis5357@uta.edu.ec",  name: "Tomás Solís (Admin)",        role: Role.admin,   password: "msolis123" },
  { email: "tecn1@uta.edu.ec",       name: "Técnico Nivel 1 (Básico)",   role: Role.tech_n1, password: "tecn1123" },
  { email: "tecn2@uta.edu.ec",       name: "Técnico Nivel 2 (Profes.)",  role: Role.tech_n2, password: "tecn2123" },
  { email: "tecn3@uta.edu.ec",       name: "Técnico Nivel 3 (DITIC)",    role: Role.tech_n3, password: "tecn3123" },
  { email: "tecn4@uta.edu.ec",       name: "Técnico Nivel 4 (Esp.)",     role: Role.tech_n4, password: "tecn4123" },
  { email: "tecn5@uta.edu.ec",       name: "Tecnico TICs Adicional",      role: Role.tech_n3, password: "tecn5123" },
  { email: "docente@uta.edu.ec",     name: "Docente de Prueba",          role: Role.user,    password: "docente123" },
  { email: "estudiante@uta.edu.ec",  name: "Estudiante de Prueba",       role: Role.user,    password: "estudiante123" },
];

async function main() {
  for (const u of seedUsers) {
    // upsert con update solo de nombre/rol; el passwordHash se actualiza solo si
    // el usuario no tenía o tenía un hash legacy (SHA-256 = 64 chars hex, no bcrypt).
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    const needsRehash =
      !existing?.passwordHash || !existing.passwordHash.startsWith("$2");

    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        ...(needsRehash ? { passwordHash: hashPassword(u.password) } : {}),
      },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: hashPassword(u.password),
      },
    });
  }
  console.log(`Seed auth-service: ${seedUsers.length} usuarios listos (contraseñas con bcrypt)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
