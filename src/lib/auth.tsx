import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  apiGet,
  apiPost,
  ApiError,
  clearSession,
  getStoredUser,
  getToken,
  storeSession,
  type AuthUser,
} from "./api";

type AuthState = {
  user: AuthUser | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const handleUnauthorized = (event: Event) => {
      const token = (event as CustomEvent<{ token: string | null }>).detail?.token;
      if (token !== getToken()) return;
      clearSession();
      setUser(null);
    };
    window.addEventListener("paint-erp:unauthorized", handleUnauthorized);

    const storedUser = getStoredUser();
    const token = getToken();
    if (!storedUser || !token) {
      clearSession();
      setUser(null);
      setReady(true);
      return () => window.removeEventListener("paint-erp:unauthorized", handleUnauthorized);
    }

    void apiGet<{ user: AuthUser }>("/auth/me")
      .then(({ user: currentUser }) => {
        if (token !== getToken()) return;
        storeSession(token, currentUser);
        setUser(currentUser);
      })
      .catch((error: unknown) => {
        if (token !== getToken()) return;
        if (error instanceof ApiError && error.status !== 401) {
          setUser(storedUser);
          return;
        }
        clearSession();
        setUser(null);
      })
      .finally(() => setReady(true));

    return () => window.removeEventListener("paint-erp:unauthorized", handleUnauthorized);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiPost<{ token: string; user: AuthUser }>("/auth/login", {
      username,
      password,
    });
    storeSession(res.token, res.user);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    void apiPost("/auth/logout", {}).catch(() => undefined);
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
