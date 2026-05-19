// Cliente HTTP hacia auth-service. HU-07 lo usa para resolver userId -> {name,email}
// en el panel técnico. Comunicación interna por la red Docker.
import axios from "axios";
import { env } from "../config/env";

export interface AuthUserLite {
  id: string;
  email: string;
  name: string;
  role: string;
}

// Resuelve un lote de userIds. Devuelve solo los que existen.
// Si el lookup falla, devolvemos lista vacía y el caller decide qué hacer
// (la enriquecimiento de tickets es opcional, no debe tumbar la respuesta).
export async function fetchUsersByIds(
  ids: string[],
  userToken: string
): Promise<AuthUserLite[]> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  const url = `${env.authServiceUrl}/auth/users/lookup`;
  const response = await axios.post<{ users: AuthUserLite[] }>(
    url,
    { ids: unique },
    {
      headers: { Authorization: `Bearer ${userToken}` },
      timeout: 5000,
    }
  );
  return response.data.users ?? [];
}
