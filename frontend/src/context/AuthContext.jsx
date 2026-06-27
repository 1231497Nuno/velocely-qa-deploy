import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setToken, getToken } from "../lib/api";

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=checking, false=anon, obj=auth
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(false);
      setReady(true);
      return;
    }
    try {
      const me = await api.get("/auth/me");
      setUser(me);
    } catch {
      setToken(null);
      setUser(false);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (email, password) => {
    const { token, user: u } = await api.post("/auth/login", { email, password });
    setToken(token);
    setUser(u);
    return u;
  };

  const logout = () => {
    setToken(null);
    setUser(false);
    window.location.href = "/login";
  };

  const isAdmin = user && user.role === "admin";

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, isAdmin, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
