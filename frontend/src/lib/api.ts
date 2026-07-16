import axios from 'axios';
import type {
  LoginResponse,
  DashboardData,
  Cliente,
  ClienteCreate,
  RecepcionPayload,
  EmpaquePayload,
  EmpaqueRecord,
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

  // URL absoluta al backend (evita pegarle al static site por error de VITE_API_URL)
  const base = getApiBaseUrl().replace(/\/$/, '');
  const loginUrl = `${base}/api/auth/login`;

  const res = await axios.post(loginUrl, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const data = res.data;
  // Si VITE_API_URL está mal, el static site devuelve HTML (string) con 200
  if (typeof data === 'string' || !data || typeof data !== 'object') {
    throw new Error(
      `Login no devolvió JSON. VITE_API_URL actual="${base || '(vacío)'}". ` +
        `Debe ser https://agropack-api.onrender.com (Environment del static site + rebuild).`
    );
  }

  if (!data.access_token && !data.accessToken) {
    throw new Error(
      `Respuesta sin access_token. URL=${loginUrl}. Body=${JSON.stringify(data).slice(0, 200)}`
    );
  }

  return {
    access_token: data.access_token || data.accessToken,
    token_type: data.token_type || 'bearer',
  };
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

/** Lista empaques recientes (público en API; útil para reportes / fallback) */
export async function getEmpaques(token?: string): Promise<EmpaqueRecord[]> {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await api.get<EmpaqueRecord[]>('/api/empaque/', { headers });
  return res.data;
}

export interface CorridaRendimientoApi {
  id: number;
  fecha: string;
  numero_empacador?: string | null;
  bins_campo: number;
  kg_entrada: number;
  kg_primera: number;
  kg_segunda: number;
  kg_salida: number;
  pct_primera: number;
  pct_segunda: number;
  pct_recuperacion: number;
  cajas_rpc: number;
  cajas_carton: number;
  bins_jugo: number;
  parrillas_rpc: number;
  parrillas_carton: number;
  parrillas_jugo: number;
  parrillas_primera?: number;
  parrillas_total: number;
  /** bins campo / parrillas de 1ra (sin jugo) */
  bins_por_parrilla: number | null;
  kg_por_ha?: number | null;
  kg_primera_por_ha?: number | null;
  kg_segunda_por_ha?: number | null;
  lotes_resumen?: string | null;
}

export interface LoteRendimientoApi {
  lote: string;
  bins_campo: number;
  kg_entrada: number;
  kg_primera: number;
  kg_segunda: number;
  kg_salida: number;
  pct_primera: number;
  pct_segunda: number;
  pct_recuperacion: number;
  cajas_rpc: number;
  cajas_carton: number;
  bins_jugo: number;
  parrillas_primera?: number;
  parrillas_total: number;
  bins_por_parrilla?: number | null;
  kg_por_ha?: number | null;
  kg_primera_por_ha?: number | null;
  kg_segunda_por_ha?: number | null;
  num_corridas: number;
  prorrateado: boolean;
}

export interface RendimientosLimonApi {
  corridas: CorridaRendimientoApi[];
  por_lote: LoteRendimientoApi[];
  acumulado: CorridaRendimientoApi;
  hectareas?: number;
}

export async function getRendimientosLimon(token: string): Promise<RendimientosLimonApi> {
  const res = await api.get<RendimientosLimonApi>('/api/reports/rendimientos-limon', {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 60000,
  });
  return res.data;
}

/** Lista empaques recientes (solo admin) */
export async function getEmpaquesAdmin(token: string): Promise<EmpaqueRecord[]> {
  const res = await api.get<EmpaqueRecord[]>('/api/empaque/admin/recientes', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

/** Corrige empaque: descuenta bins de un lote olvidado */
export async function agregarConsumoEmpaque(
  token: string,
  empaqueId: number,
  lote: string,
  bins: number
): Promise<EmpaqueRecord> {
  const res = await api.post<EmpaqueRecord>(
    `/api/empaque/${empaqueId}/agregar-consumo`,
    { lote, bins },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data;
}

/** Anula empaque de limón y revierte inventario */
export async function anularEmpaque(
  token: string,
  empaqueId: number
): Promise<{ message: string; id: number }> {
  const res = await api.post<{ message: string; id: number }>(
    `/api/empaque/${empaqueId}/anular`,
    {},
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data;
}

// ============================================
// Embarques
// ============================================
export async function createEmbarque(token: string, payload: EmbarquePayload): Promise<void> {
  await api.post('/api/embarques/', payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface ManifiestoDetalleStock {
  producto: string;
  mercado: string;
  cantidad_cajas: number;
  presentacion?: string | null;
  talla?: string | null;
  calidad?: string | null;
  stock_disponible: number;
  suficiente: boolean;
}

export interface ManifiestoParseResult {
  fecha_embarque?: string | null;
  hora_salida?: string | null;
  numero_manifiesto?: string | null;
  embarcador?: string | null;
  distribuidor?: string | null;
  lugar?: string | null;
  mercado?: string | null;
  factura?: string | null;
  total_bultos_manifiesto?: number | null;
  total_bultos_parseados: number;
  lineas_raw: Array<{
    no: number;
    bultos: number;
    descripcion: string;
    lote?: string | null;
    presentacion?: string | null;
    talla?: string | null;
    parse_ok: boolean;
    parse_note?: string | null;
  }>;
  detalles: ManifiestoDetalleStock[];
  warnings: string[];
  puede_confirmar: boolean;
  cliente_sugerido_id?: number | null;
  cliente_sugerido_nombre?: string | null;
}

/** Parsea PDF de manifiesto y cruza con inventario (sin descontar) */
export async function parseManifiesto(token: string, file: File): Promise<ManifiestoParseResult> {
  const form = new FormData();
  form.append('file', file);
  // FormData: dejar que el browser/axios pongan multipart + boundary
  // (no usar el Content-Type: application/json del cliente api)
  const res = await api.post<ManifiestoParseResult>('/api/embarques/parse-manifiesto', form, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': undefined as unknown as string,
    },
    timeout: 90000,
  });
  return res.data;
}

/** Confirma embarque desde manifiesto y descuenta inventario */
export async function confirmarManifiesto(
  token: string,
  body: {
    cliente_id: number;
    notas?: string | null;
    fecha_embarque?: string | null;
    detalles: EmbarquePayload['detalles'];
  }
): Promise<void> {
  await api.post('/api/embarques/desde-manifiesto', body, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 60000,
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
