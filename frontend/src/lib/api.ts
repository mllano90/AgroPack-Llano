import axios from 'axios';
import type {
  LoginResponse,
  DashboardData,
  Cliente,
  ClienteCreate,
  RecepcionPayload,
  EmpaquePayload,
  EmbarquePayload,
  User,
  UserCreate,
} from '../types';

/**
 * API base URL:
 * - Dev: VITE_API_URL=http://localhost:8000 (or default)
 * - Prod (nginx reverse-proxy): VITE_API_URL="" → relative /api/... same origin
 * Empty string is intentional for production; do NOT fall back with ||
 */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL;
  if (raw === undefined || raw === null) {
    return 'http://localhost:8000';
  }
  return String(raw);
}

const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ============================================
// Auth
// ============================================
export async function login(username: string, password: string): Promise<LoginResponse> {
  const params = new URLSearchParams();
  params.append('username', username);
  params.append('password', password);
  const res = await api.post<LoginResponse>('/api/auth/login', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return res.data;
}

// ============================================
// Dashboard / Reports
// ============================================
export async function getDashboard(token: string): Promise<DashboardData> {
  const res = await api.get<DashboardData>('/api/reports/dashboard', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

// ============================================
// Clientes
// ============================================
export async function getClientes(token: string): Promise<Cliente[]> {
  const res = await api.get<Cliente[]>('/api/clientes', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export async function createCliente(token: string, data: ClienteCreate): Promise<Cliente> {
  const res = await api.post<Cliente>('/api/clientes/', data, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

// ============================================
// Recepción
// ============================================
export async function createRecepcion(token: string, payload: RecepcionPayload): Promise<void> {
  await api.post('/api/recepcion/', payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ============================================
// Empaque
// ============================================
export async function createEmpaque(token: string, payload: EmpaquePayload): Promise<void> {
  await api.post('/api/empaque/', payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ============================================
// Embarques
// ============================================
export async function createEmbarque(token: string, payload: EmbarquePayload): Promise<void> {
  await api.post('/api/embarques/', payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ============================================
// User Management (new)
// ============================================
export async function getCurrentUser(token: string): Promise<User> {
  const res = await api.get<User>('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export async function getUsers(token: string, rol?: string): Promise<User[]> {
  const params = rol ? { rol } : {};
  const res = await api.get<User[]>('/api/auth/users', {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
  return res.data;
}

export async function getRoles(token: string): Promise<string[]> {
  const res = await api.get<string[]>('/api/auth/roles', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export async function registerUser(token: string, data: UserCreate): Promise<User> {
  const res = await api.post<User>('/api/auth/register', data, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export async function updateUser(token: string, userId: number, data: Partial<UserCreate>): Promise<User> {
  const res = await api.patch<User>(`/api/auth/users/${userId}`, data, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export async function deleteUser(token: string, userId: number): Promise<void> {
  await api.delete(`/api/auth/users/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
