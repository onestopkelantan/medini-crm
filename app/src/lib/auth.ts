/**
 * Production auth layer for Medini CRM (S10 T1).
 * JWT access + refresh tokens, server-side revocation, user context.
 * Replaces prototype scrypt/HMAC/localStorage session.
 */

import { api, tokenStore, setRefreshHandler, setLogoutHandler } from './api';

export interface AuthUser {
  staffId: string;
  username: string;
  name: string;
  role: string;
  branchId: string | null;
  doctorId: string | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AuthUser;
}

let currentUser: AuthUser | null = null;

export function getUser(): AuthUser | null {
  return currentUser;
}

function setUser(user: AuthUser | null) {
  currentUser = user;
  if (user) localStorage.setItem('medini_user', JSON.stringify(user));
  else localStorage.removeItem('medini_user');
}

function loadStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem('medini_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await api.post<LoginResponse>('/auth/login', { username, password });
  tokenStore.setTokens(res.accessToken, res.refreshToken);
  setUser(res.user);
  return res.user;
}

export async function logout(): Promise<void> {
  const refreshToken = tokenStore.getRefreshToken();
  if (refreshToken) {
    try {
      await api.post('/auth/logout', { refreshToken });
    } catch {
      /* best-effort server revocation; clear local state regardless */
    }
  }
  tokenStore.clearTokens();
  setUser(null);
}

export async function refresh(): Promise<boolean> {
  const refreshToken = tokenStore.getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await api.post<{ accessToken: string; refreshToken: string; expiresIn: number }>(
      '/auth/refresh',
      { refreshToken },
    );
    tokenStore.setTokens(res.accessToken, res.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await api.get<{ data: AuthUser }>('/auth/me');
    setUser(res.data);
    return res.data;
  } catch {
    return null;
  }
}

export function initAuth(): AuthUser | null {
  const stored = loadStoredUser();
  if (stored) setUser(stored);
  return stored;
}

/* Wire the API client's refresh/logout hooks. */
setRefreshHandler(refresh);
setLogoutHandler(() => setUser(null));
