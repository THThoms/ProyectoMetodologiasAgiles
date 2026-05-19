// Variables de entorno para los tests del catalog-service.
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-min-32-chars-aaaaaaaaaa";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test_catalog_db?schema=public";
