// Cliente API del módulo estación. Usa VITE_API_URL (vacío = mismo origen) + /api/estacion.
// En AgroPack puede reemplazarse por su src/lib/api.ts manteniendo estas firmas.
import type { Alerta, Comando, Config, Historial, Ultimo } from './tipos';

const BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/api/estacion`;
const CLAVE_TOKEN = 'estacion_token';

export const sesion = {
  token: (): string | null => localStorage.getItem(CLAVE_TOKEN),
  guardar: (t: string) => localStorage.setItem(CLAVE_TOKEN, t),
  borrar: () => localStorage.removeItem(CLAVE_TOKEN),
};

export class ErrorApi extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

let alNoAutorizado: () => void = () => {};
export function enNoAutorizado(fn: () => void) { alNoAutorizado = fn; }

async function pedir<T>(ruta: string, opt: RequestInit = {}): Promise<T> {
  const t = sesion.token();
  const r = await fetch(BASE + ruta, {
    ...opt,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(opt.headers || {}) },
  });
  if (r.status === 401 && !ruta.startsWith('/auth/login')) { sesion.borrar(); alNoAutorizado(); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorApi(r.status, (j as { error?: string; detail?: string }).error || (j as { detail?: string }).detail || `HTTP ${r.status}`);
  return j as T;
}

export const api = {
  login: (usuario: string, clave: string) =>
    pedir<{ token: string; usuario: string; rol: 'admin' | 'normal'; expira: number }>('/auth/login', { method: 'POST', body: JSON.stringify({ usuario, clave }) }),
  yo: () => pedir<{ usuario: string; rol: 'admin' | 'normal' }>('/auth/yo'),
  usuarios: () => pedir<{ usuarios: { usuario: string; rol: 'admin' | 'normal'; activo: boolean; creado: number }[] }>('/usuarios'),
  crearUsuario: (usuario: string, clave: string) =>
    pedir<{ ok: boolean; usuario: string; rol: 'normal' }>('/usuarios', { method: 'POST', body: JSON.stringify({ usuario, clave }) }),
  ultimo: () => pedir<Ultimo>('/ultimo'),
  historial: (v: string, rango: string) => pedir<Historial>(`/historial?var=${v}&rango=${rango}`),
  config: () => pedir<Config>('/config'),
  guardarConfig: (c: Partial<Config>) => pedir<{ ok: boolean }>('/config', { method: 'PUT', body: JSON.stringify(c) }),
  alertas: (estado: string) => pedir<{ alertas: Alerta[] }>(`/alertas?estado=${estado}`),
  resolverAlerta: (id: number) => pedir<{ ok: boolean }>(`/alertas/${id}/resolver`, { method: 'POST' }),
  comandos: () => pedir<{ comandos: Comando[] }>('/comandos'),
  crearComando: (duracion_min: number) => pedir<{ comando: Comando }>('/comandos', { method: 'POST', body: JSON.stringify({ tipo: 'ota', duracion_min }) }),
  cancelarComando: (id: number) => pedir<{ ok: boolean }>(`/comandos/${id}/cancelar`, { method: 'POST' }),
  async descargarCsv(rango: string) {
    const r = await fetch(`${BASE}/historial.csv?rango=${rango}`, { headers: { Authorization: `Bearer ${sesion.token()}` } });
    if (!r.ok) throw new ErrorApi(r.status, 'No se pudo descargar');
    const nombre = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || `estacion_${rango}.csv`;
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};
