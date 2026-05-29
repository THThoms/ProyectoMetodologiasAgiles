// Variables de entorno para los tests. Se ejecuta antes de cargar módulos que
// leen process.env (como src/config/env.ts, que requiere JWT_SECRET).
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-min-32-chars-aaaaaaaaaa";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "1h";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test_db?schema=public";
process.env.ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN ?? "uta.edu.ec";
process.env.AUTH_DEV_LOGIN = process.env.AUTH_DEV_LOGIN ?? "true";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS ?? "admin@uta.edu.ec";
