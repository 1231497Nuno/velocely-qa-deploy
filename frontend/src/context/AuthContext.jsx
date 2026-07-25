import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { api, setToken, getToken, getActivationToken, setActivationToken } from "../lib/api";

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

  const login = useCallback(async (loginId, password) => {
    const data = await api.post("/auth/login", { login: loginId, password });
    if (data.must_set_password && data.activation_token) {
      setToken(null);
      setActivationToken(data.activation_token);
      setUser(false);
      return { must_set_password: true, user: data.user };
    }
    setActivationToken(null);
    setToken(data.token);
    setUser(data.user);
    return { must_set_password: false, user: data.user };
  }, []);

  const setPassword = useCallback(async (password, passwordConfirm) => {
    const act = getActivationToken();
    if (!act) throw new Error("Sessão de activação expirada. Volte a entrar com o código.");
    const data = await api.post(
      "/auth/set-password",
      { password, password_confirm: passwordConfirm },
      { headers: { Authorization: `Bearer ${act}` } }
    );
    setActivationToken(null);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setActivationToken(null);
    setUser(false);
    window.location.href = "/login";
  }, []);

  const isAdmin = !!(user && user.perfil && user.perfil.admin);

  const can = useCallback(
    (modulo, acao = "view") => {
      if (!user || !user.perfil) return false;
      if (user.perfil.admin) return true;
      return !!(user.perfil.permissoes?.[modulo]?.[acao]);
    },
    [user]
  );

  const value = useMemo(
    () => ({ user, ready, login, setPassword, logout, isAdmin, can, refresh }),
    [user, ready, login, setPassword, logout, isAdmin, can, refresh]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
