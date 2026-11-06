import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DataStore } from '../domain/types';

interface DataContextValue {
  data: DataStore | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

let revision = 0;
const tokenKey = 'pkufa-query-session-v1';
export const apiBase = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
export function assetUrl(path: string) { return import.meta.env.BASE_URL + path.replace(/^\//, ''); }

export async function requestApi(url: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers);
  const token = sessionStorage.getItem(tokenKey);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options?.method && options.method !== 'GET' && !headers.has('If-Match')) headers.set('If-Match', String(revision));
  return fetch(apiBase + url, { ...options, headers });
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await requestApi(url, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: '网络请求失败' }));
    throw new Error(body.error || '操作失败');
  }
  if (url === '/api/logout') sessionStorage.removeItem(tokenKey);
  if (response.status === 204) return undefined as T;
  const result = await response.json();
  if (['/api/login', '/api/referee-login', '/api/me/password'].includes(url) && result.token) sessionStorage.setItem(tokenKey, result.token);
  if (url === '/api/data') revision = result.revision || 0;
  return result;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DataStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setError('');
      setData(await api<DataStore>('/api/data'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <DataContext.Provider value={{ data, loading, error, refresh }}>{children}</DataContext.Provider>;
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used inside DataProvider');
  return context;
}
