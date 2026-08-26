/**
 * Production REST API client for Medini CRM backend (S10 T1).
 * Centralizes base URL, auth headers, error handling, refresh, logout.
 * Replaces the tRPC prototype data layer.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  correlationId?: string;
}

export class ApiRequestError extends Error {
  public readonly status: number;
  public readonly body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }
}

/** Type-safe error-message extractor for UI handlers (replaces `(e: any)`). */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiRequestError) return e.body?.message || e.message || fallback;
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}

type RefreshHandler = () => Promise<boolean>;
type LogoutHandler = () => void;

let refreshHandler: RefreshHandler | null = null;
let logoutHandler: LogoutHandler | null = null;

export function setRefreshHandler(fn: RefreshHandler) { refreshHandler = fn; }
export function setLogoutHandler(fn: LogoutHandler) { logoutHandler = fn; }

function getAccessToken(): string | null {
  return localStorage.getItem('medini_access_token');
}

function getRefreshToken(): string | null {
  return localStorage.getItem('medini_refresh_token');
}

function setTokens(access: string, refresh: string) {
  localStorage.setItem('medini_access_token', access);
  localStorage.setItem('medini_refresh_token', refresh);
}

function clearTokens() {
  localStorage.removeItem('medini_access_token');
  localStorage.removeItem('medini_refresh_token');
  localStorage.removeItem('medini_user');
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    if (body?.error) return body.error;
    return { code: 'UNKNOWN', message: body?.message ?? `HTTP ${res.status}` };
  } catch {
    return { code: 'UNKNOWN', message: `HTTP ${res.status}` };
  }
}

async function doFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/v1${path}`, { ...init, headers });

  const isAuthEndpoint = path.startsWith('/auth/login') || path.startsWith('/auth/register');
  if (res.status === 401 && retry && refreshHandler && !isAuthEndpoint) {
    const refreshed = await refreshHandler();
    if (refreshed) return doFetch<T>(path, init, false);
    clearTokens();
    logoutHandler?.();
    throw new ApiRequestError(401, { code: 'UNAUTHORIZED', message: 'Session expired' });
  }

  if (!res.ok) {
    const err = await parseError(res);
    throw new ApiRequestError(res.status, err);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => doFetch<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) => doFetch<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => doFetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => doFetch<T>(path, { method: 'DELETE' }),
};

export const tokenStore = {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
};
