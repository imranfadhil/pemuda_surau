import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, setTokenGetter } from './api.js';

const AuthContext = createContext(null);
const TOKEN_KEY = 'pemuda_surau_token';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));

  setTokenGetter(() => token);

  useEffect(() => {
    let active = true;
    if (!token) {
      setUser(null);
      setLoading(false);
      return undefined;
    }
    api
      .me()
      .then((data) => {
        if (active) setUser(data.user);
      })
      .catch(() => {
        if (active) {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [token]);

  function login(newToken, newUser) {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }

  function refreshUser() {
    return api.me().then((data) => setUser(data.user));
  }

  const value = useMemo(
    () => ({ token, user, loading, login, logout, refreshUser, setUser }),
    [token, user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
