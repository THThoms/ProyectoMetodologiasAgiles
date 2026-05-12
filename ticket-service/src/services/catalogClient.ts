import axios from "axios";
import { env } from "../config/env";

export interface CatalogService {
  id: string;
  name: string;
  isActive: boolean;
  levelEntry: "N1" | "N2" | "N3" | "N4";
}

// Cliente HTTP hacia catalog-service. Comunicación interna entre microservicios
// (red Docker). NO pasa por el API Gateway porque es tráfico backend-to-backend.
export async function fetchService(serviceId: string, userToken: string): Promise<CatalogService> {
  const url = `${env.catalogServiceUrl}/services/${serviceId}`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${userToken}` },
    timeout: 5000,
  });
  return response.data.service as CatalogService;
}

export class ServiceNotFoundError extends Error {
  constructor(serviceId: string) {
    super(`Servicio ${serviceId} no encontrado en el catálogo`);
    this.name = "ServiceNotFoundError";
  }
}
