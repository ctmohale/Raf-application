import { createContext, useContext, useMemo, useState } from 'react';
import { apiRequest } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('orc_token') || sessionStorage.getItem('orc_token'));
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('orc_user') || sessionStorage.getItem('orc_user');
    return raw ? JSON.parse(raw) : null;
  });

  function storeSession(nextUser, nextToken, remember = true) {
    const storage = remember ? localStorage : sessionStorage;
    const otherStorage = remember ? sessionStorage : localStorage;
    otherStorage.removeItem('orc_token');
    otherStorage.removeItem('orc_user');
    storage.setItem('orc_token', nextToken);
    storage.setItem('orc_user', JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }

  async function login(email, password, options = {}) {
    const result = await apiRequest('/api/auth/login', { method: 'POST', body: { email, password } });
    storeSession(result.user, result.token, options.remember !== false);
  }

  async function register(name, email, password) {
    const result = await apiRequest('/api/auth/register', { method: 'POST', body: { name, email, password } });
    if (result.token) {
      storeSession(result.user, result.token, true);
    }
    return result;
  }

  function logout() {
    localStorage.removeItem('orc_token');
    localStorage.removeItem('orc_user');
    sessionStorage.removeItem('orc_token');
    sessionStorage.removeItem('orc_user');
    setToken(null);
    setUser(null);
  }

  function updateUser(patch) {
    setUser((current) => {
      if (!current) return current;
      const nextUser = { ...current, ...patch };
      const storage = localStorage.getItem('orc_token') ? localStorage : sessionStorage;
      storage.setItem('orc_user', JSON.stringify(nextUser));
      return nextUser;
    });
  }

  const value = useMemo(() => ({ token, user, login, register, logout, updateUser, isAuthenticated: Boolean(token) }), [token, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
