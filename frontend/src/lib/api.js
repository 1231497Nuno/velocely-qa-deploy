import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API });

export const api = {
  get: (p) => client.get(p).then((r) => r.data),
  post: (p, b) => client.post(p, b).then((r) => r.data),
  put: (p, b) => client.put(p, b).then((r) => r.data),
  del: (p) => client.delete(p).then((r) => r.data),
};

export const eur = (v) =>
  new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(Number(v || 0));

export const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("pt-PT");
  } catch {
    return d;
  }
};
