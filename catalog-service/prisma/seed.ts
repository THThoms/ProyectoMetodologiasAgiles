import { PrismaClient, Level, ResponsibleArea } from "@prisma/client";

const prisma = new PrismaClient();

// Cada servicio puede declarar una regla de enrutamiento configurable (HU-06)
// y un área responsable (Sprint 2 rev) que determina qué técnicos pueden atender.
const services: Array<{
  name: string;
  description: string;
  levelEntry: Level;
  responsibleArea: ResponsibleArea;
  priorityHigh?: Level;
  priorityCritical?: Level;
  isCritical?: boolean;
}> = [
  { name: "Red e Internet",           description: "Conectividad de red, WiFi institucional, problemas de acceso a Internet.", levelEntry: Level.N1, responsibleArea: ResponsibleArea.TECHNICIANS, priorityHigh: Level.N2, priorityCritical: Level.N3 },
  { name: "Internet / Conectividad",  description: "Problemas de red, WiFi institucional, VPN.",                                levelEntry: Level.N3, responsibleArea: ResponsibleArea.TECHNICIANS },
  { name: "Correo Electrónico",       description: "Acceso, configuración y problemas con el correo @uta.edu.ec.",              levelEntry: Level.N2, responsibleArea: ResponsibleArea.TICS },
  { name: "Equipos / Hardware",       description: "Computadoras, impresoras, periféricos.",                                    levelEntry: Level.N1, responsibleArea: ResponsibleArea.TECHNICIANS, priorityHigh: Level.N2 },
  { name: "Software Institucional",   description: "Software académico/administrativo licenciado por UTA.",                     levelEntry: Level.N2, responsibleArea: ResponsibleArea.TICS },
  { name: "MOODLE",                   description: "Plataforma de aulas virtuales.",                                            levelEntry: Level.N3, responsibleArea: ResponsibleArea.TICS },
  { name: "Calificaciones (SGA)",     description: "Sistema de Gestión Académica - notas y matrícula.",                          levelEntry: Level.N3, responsibleArea: ResponsibleArea.TICS },
  { name: "Seguridad de la Información", description: "Incidentes de seguridad, accesos sospechosos, malware.",                 levelEntry: Level.N3, responsibleArea: ResponsibleArea.TICS, priorityHigh: Level.N3, priorityCritical: Level.N4, isCritical: true },
];

// HU-10 - Artículos iniciales para la base de conocimiento institucional.
// `keywords` se guarda siempre en lowercase para que la búsqueda case-insensitive
// pueda usar `hasSome` directamente con la query también en lowercase.
const knowledgeArticles: Array<{
  title: string;
  problemDescription: string;
  solution: string;
  keywords: string[];
  serviceName?: string;
}> = [
  {
    title: "Error de conexión VPN institucional",
    problemDescription:
      "El usuario reporta que no puede establecer conexión con la VPN institucional para acceder a recursos internos de la UTA desde fuera del campus.",
    solution:
      "1) Verificar que el usuario tenga credenciales institucionales activas. " +
      "2) Confirmar conexión a internet desde el equipo. " +
      "3) Reinstalar o reconfigurar el cliente VPN siguiendo la guía DITIC. " +
      "4) Si el problema persiste, escalar a Red e Internet con captura del log de conexión.",
    keywords: ["vpn", "conexion", "acceso remoto", "credenciales", "red"],
    serviceName: "Red e Internet",
  },
  {
    title: "WiFi institucional intermitente en aulas",
    problemDescription:
      "Los docentes y estudiantes reportan caídas frecuentes del WiFi institucional en bloques específicos del campus, afectando clases y consultas al SGA.",
    solution:
      "1) Verificar saturación del punto de acceso más cercano. " +
      "2) Solicitar reinicio remoto del AP al equipo de redes. " +
      "3) Si el problema afecta a un bloque completo, reportar a Red e Internet N2 para inspección física del switch.",
    keywords: ["wifi", "red", "conectividad", "aulas", "punto de acceso"],
    serviceName: "Red e Internet",
  },
  {
    title: "Impresora institucional no responde",
    problemDescription:
      "Una impresora compartida deja de responder a los trabajos enviados desde varios equipos de la facultad.",
    solution:
      "1) Verificar conexión eléctrica y de red de la impresora. " +
      "2) Reiniciar el dispositivo y la cola de impresión local. " +
      "3) Limpiar trabajos atascados en el spooler. " +
      "4) Reinstalar el driver desde el portal de soporte si persiste.",
    keywords: ["impresora", "hardware", "spooler", "driver"],
    serviceName: "Equipos / Hardware",
  },
];

async function main() {
  for (const s of services) {
    const ruleData = {
      levelEntry: s.levelEntry,
      priorityHigh: s.priorityHigh ?? null,
      priorityCritical: s.priorityCritical ?? null,
      isCritical: s.isCritical ?? false,
    };
    await prisma.service.upsert({
      where: { name: s.name },
      update: {
        description: s.description,
        levelEntry: s.levelEntry,
        responsibleArea: s.responsibleArea,
        isActive: true,
        routingRule: { upsert: { create: ruleData, update: ruleData } },
      },
      create: {
        name: s.name,
        description: s.description,
        levelEntry: s.levelEntry,
        responsibleArea: s.responsibleArea,
        routingRule: { create: ruleData },
      },
    });
  }
  console.log(`Seed catalog-service: ${services.length} servicios cargados`);

  // HU-10 - Knowledge base seed. Solo crea artículos si la tabla está vacía,
  // para no duplicar contenido en cada arranque del contenedor.
  const existingCount = await prisma.knowledgeArticle.count();
  if (existingCount === 0) {
    for (const k of knowledgeArticles) {
      const service = k.serviceName
        ? await prisma.service.findUnique({ where: { name: k.serviceName } })
        : null;
      await prisma.knowledgeArticle.create({
        data: {
          title: k.title,
          problemDescription: k.problemDescription,
          solution: k.solution,
          keywords: k.keywords.map((s) => s.toLowerCase()),
          serviceId: service?.id ?? null,
        },
      });
    }
    console.log(`Seed catalog-service: ${knowledgeArticles.length} artículos de conocimiento cargados`);
  } else {
    console.log(`Seed catalog-service: knowledge base ya tiene ${existingCount} artículos (skipped)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
