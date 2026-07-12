import { createContext, useContext, useMemo, useState } from 'react';
import { apiRequest } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('orc_token'));
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('orc_user');
    return raw ? JSON.parse(raw) : null;
  });

  async function login(email, password) {
    const result = await apiRequest('/api/auth/login', { method: 'POST', body: { email, password } });
    localStorage.setItem('orc_token', result.token);
    localStorage.setItem('orc_user', JSON.stringify(result.user));
    setToken(result.token);
    setUser(result.user);
  }

  async function register(name, email, password) {
    const result = await apiRequest('/api/auth/register', { method: 'POST', body: { name, email, password } });
    localStorage.setItem('orc_token', result.token);
    localStorage.setItem('orc_user', JSON.stringify(result.user));
    setToken(result.token);
    setUser(result.user);
  }

  function logout() {
    localStorage.removeItem('orc_token');
    localStorage.removeItem('orc_user');
    setToken(null);
    setUser(null);
  }

  const value = useMemo(() => ({ token, user, login, register, logout, isAuthenticated: Boolean(token) }), [token, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
