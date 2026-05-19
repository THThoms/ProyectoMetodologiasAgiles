// Variables de entorno para los tests. Se ejecuta antes de cargar módulos
// que leen process.env (como src/config/env.ts).
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-min-32-chars-aaaaaaaaaa";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "1h";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test_db?schema=public";
process.env.CATALOG_SERVICE_URL =
  process.env.CATALOG_SERVICE_URL ?? "http://catalog-service:3002";
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";
