import dotenv from "dotenv";
import path from "path";

dotenv.config();

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3003),
  jwtSecret: required("JWT_SECRET", process.env.JWT_SECRET),
  catalogServiceUrl: required("CATALOG_SERVICE_URL", process.env.CATALOG_SERVICE_URL),
  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), "uploads"),

  upload: {
    maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
    maxFiles: 5,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/jpg"],
  },
};
