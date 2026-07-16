import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API });

const TOKEN_KEY = "velocely_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

client.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

client.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !err.config?.url?.includes("/auth/login")) {
      setToken(null);
      if (window.location.pathname !== "/login") window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export const api = {
  get: (p) => client.get(p).then((r) => r.data),
  post: (p, b) => client.post(p, b).then((r) => r.data),
  put: (p, b) => client.put(p, b).then((r) => r.data),
  del: (p) => client.delete(p).then((r) => r.data),
};

let CURRENCY = "€";
export const setCurrency = (s) => { if (s) CURRENCY = s; };

export const eur = (v) =>
  `${new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0))} ${CURRENCY}`;

export const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("pt-PT");
  } catch {
    return d;
  }
};
