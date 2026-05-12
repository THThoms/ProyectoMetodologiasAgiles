import dotenv from "dotenv";

dotenv.config();

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3002),
  jwtSecret: required("JWT_SECRET", process.env.JWT_SECRET),
};
