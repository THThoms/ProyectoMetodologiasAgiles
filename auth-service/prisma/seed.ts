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
type SeedUser = {
  email: string;
  name: string;
  role: Role;
  password: string;
  legacyEmails?: string[];
};

const seedUsers: SeedUser[] = [
  { email: "admin@uta.edu.ec",       name: "Administrador UTA",          role: Role.admin,   password: "admin123" },
  { email: "msolis5357@uta.edu.ec",  name: "Tomás Solís (Admin)",        role: Role.admin,   password: "msolis123" },
  { email: "carlos.mena@uta.edu.ec",     name: "Carlos Mena",     role: Role.tech_n1, password: "tecn1123", legacyEmails: ["tecn1@uta.edu.ec"] },
  { email: "daniela.paredes@uta.edu.ec", name: "Daniela Paredes", role: Role.tech_n2, password: "tecn2123", legacyEmails: ["tecn2@uta.edu.ec"] },
  { email: "andres.salazar@uta.edu.ec",  name: "Andrés Salazar",  role: Role.tech_n3, password: "tecn3123", legacyEmails: ["tecn3@uta.edu.ec"] },
  { email: "valeria.nunez@uta.edu.ec",   name: "Valeria Núñez",   role: Role.tech_n4, password: "tecn4123", legacyEmails: ["tecn4@uta.edu.ec"] },
  { email: "mateo.cordova@uta.edu.ec",   name: "Mateo Córdova",   role: Role.tech_n3, password: "tecn5123", legacyEmails: ["tecn5@uta.edu.ec"] },
  { email: "docente@uta.edu.ec",     name: "Docente de Prueba",          role: Role.user,    password: "docente123" },
  { email: "estudiante@uta.edu.ec",  name: "Estudiante de Prueba",       role: Role.user,    password: "estudiante123" },
];

async function main() {
  for (const u of seedUsers) {
    let existing = await prisma.user.findUnique({ where: { email: u.email } });

    // Renombra las cuentas artificiales existentes conservando su ID,
    // sesiones y referencias históricas en otros servicios.
    if (!existing && u.legacyEmails?.length) {
      const legacyUser = await prisma.user.findFirst({
        where: { email: { in: u.legacyEmails } },
      });

      if (legacyUser) {
        existing = await prisma.user.update({
          where: { id: legacyUser.id },
          data: {
            email: u.email,
            name: u.name,
            role: u.role,
          },
        });
      }
    }

    // upsert con update solo de nombre/rol; el passwordHash se actualiza solo si
    // el usuario no tenía o tenía un hash legacy (SHA-256 = 64 chars hex, no bcrypt).
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
