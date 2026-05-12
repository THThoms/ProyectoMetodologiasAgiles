import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { env } from "../config/env";

if (!fs.existsSync(env.uploadDir)) {
  fs.mkdirSync(env.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  filename: (_req, file, cb) => {
    // Nombre único: <timestamp>-<random>.<ext>. Evitamos depender del nombre del cliente.
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    cb(null, safe);
  },
});

export const uploadAttachments = multer({
  storage,
  limits: {
    fileSize: env.upload.maxFileSizeBytes,
    files: env.upload.maxFiles,
  },
  fileFilter: (_req, file, cb) => {
    if (!env.upload.allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error(`Tipo no permitido: ${file.mimetype}. Solo JPG/PNG.`));
    }
    cb(null, true);
  },
});
