import { PrismaClient, Level } from "@prisma/client";

const prisma = new PrismaClient();

const services: Array<{
  name: string;
  description: string;
  levelEntry: Level;
}> = [
  { name: "Internet / Conectividad",  description: "Problemas de red, WiFi institucional, VPN.",                  levelEntry: Level.N3 },
  { name: "Correo Electrónico",       description: "Acceso, configuración y problemas con el correo @uta.edu.ec.", levelEntry: Level.N2 },
  { name: "Equipos / Hardware",       description: "Computadoras, impresoras, periféricos.",                       levelEntry: Level.N1 },
  { name: "Software Institucional",   description: "Software académico/administrativo licenciado por UTA.",        levelEntry: Level.N2 },
  { name: "MOODLE",                   description: "Plataforma de aulas virtuales.",                               levelEntry: Level.N3 },
  { name: "Calificaciones (SGA)",     description: "Sistema de Gestión Académica - notas y matrícula.",             levelEntry: Level.N3 },
];

async function main() {
  for (const s of services) {
    await prisma.service.upsert({
      where: { name: s.name },
      update: {
        description: s.description,
        levelEntry: s.levelEntry,
        isActive: true,
        routingRule: { upsert: { create: { levelEntry: s.levelEntry }, update: { levelEntry: s.levelEntry } } },
      },
      create: {
        name: s.name,
        description: s.description,
        levelEntry: s.levelEntry,
        routingRule: { create: { levelEntry: s.levelEntry } },
      },
    });
  }
  console.log(`Seed catalog-service: ${services.length} servicios cargados`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
