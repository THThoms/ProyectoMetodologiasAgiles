import { ConfidentialClientApplication, Configuration, LogLevel } from "@azure/msal-node";
import { env } from "../config/env";

// Lazy: solo construye el cliente cuando se intenta usar SSO real.
// Permite que el servicio arranque sin AZURE_AD_* configurado (modo dev-login).
let cachedClient: ConfidentialClientApplication | null = null;

export function getMsalClient(): ConfidentialClientApplication {
  if (!env.ssoConfigured) {
    throw new Error("SSO_NOT_CONFIGURED");
  }
  if (!cachedClient) {
    const msalConfig: Configuration = {
      auth: {
        clientId: env.azure.clientId,
        authority: `https://login.microsoftonline.com/${env.azure.tenantId}`,
        clientSecret: env.azure.clientSecret,
      },
      system: {
        loggerOptions: {
          loggerCallback: (level, message) => {
            if (level === LogLevel.Error) {
              console.error("[MSAL]", message);
            }
          },
          piiLoggingEnabled: false,
          logLevel: LogLevel.Warning,
        },
      },
    };
    cachedClient = new ConfidentialClientApplication(msalConfig);
  }
  return cachedClient;
}

export const SCOPES = ["openid", "profile", "email", "User.Read"];
