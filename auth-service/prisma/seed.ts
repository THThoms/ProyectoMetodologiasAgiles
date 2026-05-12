import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

// Usuarios de prueba para desarrollo sin Azure AD activo.
// En producción real, los usuarios se crean automáticamente al hacer SSO Microsoft.
const seedUsers: Array<{ email: string; name: string; role: Role }> = [
  { email: "admin@uta.edu.ec",    name: "Administrador UTA",        role: Role.admin   },
  { email: "tecn1@uta.edu.ec",    name: "Técnico Nivel 1 (Básico)", role: Role.tech_n1 },
  { email: "tecn2@uta.edu.ec",    name: "Técnico Nivel 2 (Profes.)", role: Role.tech_n2 },
  { email: "tecn3@uta.edu.ec",    name: "Técnico Nivel 3 (DITIC)",  role: Role.tech_n3 },
  { email: "tecn4@uta.edu.ec",    name: "Técnico Nivel 4 (Esp.)",   role: Role.tech_n4 },
  { email: "docente@uta.edu.ec",  name: "Docente de Prueba",        role: Role.user    },
  { email: "estudiante@uta.edu.ec", name: "Estudiante de Prueba",   role: Role.user    },
];

async function main() {
  for (const u of seedUsers) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: u,
    });
  }
  console.log(`Seed auth-service: ${seedUsers.length} usuarios de prueba listos`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
