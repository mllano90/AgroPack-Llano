import axios from 'axios';
import { getApiBaseUrl } from './api';

export type CalidadCatalogo = 'primera' | 'segunda';

export interface TipoCosecha {
  codigo: string;
  nombre: string;
  fijo: boolean;
  id?: number;
}

export interface TipoCaja {
  id: number;
  codigo: string;
  nombre: string;
}

export interface ParametroCatalogo {
  id: number;
  calidad: CalidadCatalogo;
  tipo_caja_id: number;
  tipo_caja: string;
  kg: number;
  cajas_por_parrilla: number;
}

export interface ProductoCatalogo {
  id: number;
  codigo: string;
  nombre: string;
  tipo_cosecha: string;
  tipo_cosecha_nombre: string;
  peso_contenedor_kg: number | null;
  hectareas: number | null;
  activo: boolean;
  configurado: boolean;
  parametros: ParametroCatalogo[];
}

export interface CampoCatalogo {
  producto_id: number;
  lote: string;
  cantidad_disponible: number;
}

export interface InventarioCatalogo {
  id: number;
  producto_id: number;
  producto: string;
  codigo: string;
  tipo_caja_id: number;
  tipo_caja: string;
  calidad: string;
  lote: string;
  cantidad_stock: number;
  kg: number | null;
  cajas_por_parrilla: number | null;
}

export interface PresentacionReporte {
  tipo_caja_id: number;
  nombre: string;
  calidad: string;
  kg_caja: number;
  cajas_por_parrilla: number;
  cajas: number;
  kg: number;
  parrillas: number;
  pct: number;
}

export interface ReporteCatalogo extends ProductoCatalogo {
  contenedores: number;
  kg_campo: number;
  kg_primera: number;
  kg_segunda: number;
  pct_primera: number;
  pct_segunda: number;
  kg_primera_por_ha: number | null;
  kg_segunda_por_ha: number | null;
  ton_por_ha: number | null;
  parrillas_primera: number;
  contenedores_por_parrilla: number | null;
  por_presentacion_primera: PresentacionReporte[];
  por_presentacion_segunda: PresentacionReporte[];
  campo: Array<{ lote: string; cantidad_disponible: number }>;
  inventario_final: InventarioCatalogo[];
  empaques: Array<{
    id: number;
    fecha: string | null;
    lote: string;
    cantidad_campo: number;
    lineas: Array<{ tipo_caja: string; calidad: string; cantidad: number; kg: number }>;
  }>;
  embarques: Array<{
    id: number;
    fecha_salida: string | null;
    cliente_id: number;
    cliente: string;
    notas: string | null;
    lineas: Array<{
      producto_id: number;
      producto: string;
      tipo_caja: string;
      calidad: string;
      lote: string;
      cantidad: number;
    }>;
  }>;
}

function client(token: string) {
  return axios.create({
    baseURL: getApiBaseUrl(),
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function mensajeError(err: unknown): string {
  const e = err as { response?: { data?: { detail?: unknown } }; message?: string };
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === 'object' && 'msg' in item) return String((item as { msg: string }).msg);
        return JSON.stringify(item);
      })
      .join('; ');
  }
  return e?.message || 'Error';
}

export async function listarTiposCosecha(token: string): Promise<TipoCosecha[]> {
  const res = await client(token).get<TipoCosecha[]>('/api/catalogo/tipos-cosecha');
  return res.data;
}

export async function crearTipoCosecha(token: string, nombre: string): Promise<TipoCosecha> {
  const res = await client(token).post<TipoCosecha>('/api/catalogo/tipos-cosecha', { nombre });
  return res.data;
}

export async function listarTiposCaja(token: string): Promise<TipoCaja[]> {
  const res = await client(token).get<TipoCaja[]>('/api/catalogo/tipos-caja');
  return res.data;
}

export async function crearTipoCaja(token: string, nombre: string): Promise<TipoCaja> {
  const res = await client(token).post<TipoCaja>('/api/catalogo/tipos-caja', { nombre });
  return res.data;
}

export async function listarProductosCatalogo(token: string): Promise<ProductoCatalogo[]> {
  const res = await client(token).get<ProductoCatalogo[]>('/api/catalogo/productos');
  return res.data;
}

export async function crearProductoCatalogo(token: string, nombre: string): Promise<ProductoCatalogo> {
  const res = await client(token).post<ProductoCatalogo>('/api/catalogo/productos', { nombre });
  return res.data;
}

export async function configurarProducto(
  token: string,
  id: number,
  body: {
    tipo_cosecha: string;
    peso_contenedor_kg: number;
    hectareas: number | null;
    parametros: Array<{
      calidad: CalidadCatalogo;
      tipo_caja_id: number;
      kg: number;
      cajas_por_parrilla: number;
    }>;
  }
): Promise<ProductoCatalogo> {
  const res = await client(token).put<ProductoCatalogo>(`/api/catalogo/productos/${id}`, body);
  return res.data;
}

export async function cambiarActivoProducto(
  token: string,
  id: number,
  activo: boolean
): Promise<ProductoCatalogo> {
  const res = await client(token).patch<ProductoCatalogo>(`/api/catalogo/productos/${id}/activo`, { activo });
  return res.data;
}

export async function eliminarProductoCatalogo(token: string, id: number): Promise<void> {
  await client(token).delete(`/api/catalogo/productos/${id}`);
}

export async function crearRecepcionCatalogo(
  token: string,
  body: { producto_id: number; cantidad: number; lote?: string; fecha?: string | null }
) {
  const res = await client(token).post('/api/catalogo/recepciones', body);
  return res.data;
}

export async function listarCampoCatalogo(token: string, productoId: number): Promise<CampoCatalogo[]> {
  const res = await client(token).get<CampoCatalogo[]>('/api/catalogo/campo', {
    params: { producto_id: productoId },
  });
  return res.data;
}

export async function crearEmpaqueCatalogo(
  token: string,
  body: {
    producto_id: number;
    lote: string;
    cantidad_campo: number;
    fecha?: string | null;
    lineas: Array<{ parametro_id: number; cantidad: number }>;
  }
) {
  const res = await client(token).post('/api/catalogo/empaques', body);
  return res.data;
}

export async function listarInventarioCatalogo(
  token: string,
  productoId?: number
): Promise<InventarioCatalogo[]> {
  const res = await client(token).get<InventarioCatalogo[]>('/api/catalogo/inventario', {
    params: productoId != null ? { producto_id: productoId } : {},
  });
  return res.data;
}

export async function crearEmbarqueCatalogo(
  token: string,
  body: {
    cliente_id: number;
    notas?: string;
    fecha?: string | null;
    lineas: Array<{ inventario_id: number; cantidad: number }>;
  }
) {
  const res = await client(token).post('/api/catalogo/embarques', body);
  return res.data;
}

export async function reporteCatalogo(token: string, productoId: number): Promise<ReporteCatalogo> {
  const res = await client(token).get<ReporteCatalogo>(`/api/catalogo/reportes/${productoId}`);
  return res.data;
}
