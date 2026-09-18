/**
 * Cliente HTTP — camada infrastructure.
 *
 * REACT_APP_BACKEND_URL definido → API absoluta (ex. http://localhost:8000/api).
 * Vazio/omitido → /api no mesmo origin (nginx / proxy em staging).
 */
import axios from "axios";

const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
export const API = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";

const client = axios.create({ baseURL: API });

const TOKEN_KEY = "velocely_token";
const ACTIVATION_KEY = "velocely_activation";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

export const getActivationToken = () => sessionStorage.getItem(ACTIVATION_KEY);
export const setActivationToken = (t) =>
  t ? sessionStorage.setItem(ACTIVATION_KEY, t) : sessionStorage.removeItem(ACTIVATION_KEY);

client.interceptors.request.use((config) => {
  const t = getToken();
  if (t && !config.headers?.Authorization) {
    config.headers.Authorization = `Bearer ${t}`;
  }
  return config;
});

client.interceptors.response.use(
  (r) => r,
  async (err) => {
    const cfg = err.config || {};
    const status = err.response?.status;
    const network = !err.response;
    // Render free: API a dormir → 1 retry após pausa curta
    if (!cfg.__retried && (network || status === 502 || status === 503 || status === 504)) {
      cfg.__retried = true;
      await new Promise((r) => setTimeout(r, 1800));
      return client.request(cfg);
    }
    const url = cfg.url || "";
    const isAuthFlow =
      url.includes("/auth/login") ||
      url.includes("/auth/set-password") ||
      url.includes("/auth/password/");
    if (err.response?.status === 401 && !isAuthFlow) {
      setToken(null);
      if (window.location.pathname !== "/login" && window.location.pathname !== "/definir-password") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export const api = {
  get: (p) => client.get(p).then((r) => r.data),
  post: (p, b, config) => client.post(p, b, config).then((r) => r.data),
  put: (p, b) => client.put(p, b).then((r) => r.data),
  del: (p) => client.delete(p).then((r) => r.data),
};
