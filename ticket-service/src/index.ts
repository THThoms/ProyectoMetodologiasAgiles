import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.port, () => {
  console.log(`ticket-service escuchando en puerto ${env.port}`);
  console.log(`  uploads dir: ${env.uploadDir}`);
});
