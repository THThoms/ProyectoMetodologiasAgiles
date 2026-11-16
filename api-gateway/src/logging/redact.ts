// Parámetros de URL que nunca deben quedar en un registro: el código de
// autorización de Microsoft, el código SSO de un solo uso, el `state` OAuth y
// cualquier token. Se conserva el nombre del parámetro para depurar.
const SENSITIVE = /([?&](?:code|state|token|id_token|access_token|client_info|session_state)=)[^&#\s]*/gi;

export function redactUrl(url: string): string {
  return url.replace(SENSITIVE, "$1[REDACTADO]");
}
