import { createApp } from "./app";
import { installProcessSafetyNet } from "./utils/asyncRoutes";
import { env } from "./config/env";

// Un rechazo de promesa sin manejar se registra en vez de terminar el proceso.
installProcessSafetyNet("catalog-service");

const app = createApp();

app.listen(env.port, () => {
  console.log(`catalog-service escuchando en puerto ${env.port}`);
});
