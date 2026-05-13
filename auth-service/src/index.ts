import { createApp } from "./app";
import { env } from "./config/env";
import dns from "dns";
import https from "https";
import http from "http";

// Forzar IPv4 al salir a Internet: el resolver Docker devuelve AAAA pero el
// contenedor no rutea IPv6 -> ENETUNREACH al llamar a login.microsoftonline.com.
dns.setDefaultResultOrder("ipv4first");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(https.globalAgent as any).options.family = 4;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(http.globalAgent as any).options.family = 4;

const app = createApp();

app.listen(env.port, () => {
  console.log(`auth-service escuchando en puerto ${env.port}`);
});
