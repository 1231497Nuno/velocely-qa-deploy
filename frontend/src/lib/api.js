/** Fachada de compatibilidade — preferir @/infrastructure/api e @/domain. */
export { api, API, getToken, setToken } from "@/infrastructure/api";
export { eur, fmtDate, setCurrency } from "@/domain";
