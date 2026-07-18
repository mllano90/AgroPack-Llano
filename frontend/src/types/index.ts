// ============================================
// Domain Types - AgroPack Llano
// These should stay in sync with backend schemas
// ============================================

// --- Enums / Literal Unions ---
export type Producto = 'uva' | 'limon_amarillo';

export type Variedad = 'early_sweet' | 'flame' | 'summer_royal';

export type TipoCultivo = 'organica' | 'convencional';

export type TipoMercado = 'nacional' | 'exportacion';

export type TipoRecepcion = 'campo' | 'carton';

// --- Inventario ---
export interface InventarioCampoItem {
  variedad: Variedad;
  mercado: TipoMercado;
  cantidad: number;
}

export interface InventarioFinalItem {
  producto: Producto;
  variedad?: Variedad | null;
  tipo_cultivo?: TipoCultivo | null;
  mercado: TipoMercado;
  cantidad_stock: number;
  // Limón specific
  presentacion?: string | null;
  calidad?: string | null;
  talla?: string | null;
}

export interface DesverdizadoItem {
  lote: string;
  cantidad_bins_disponibles: number;
  fecha_recepcion: string;
  fecha_tentativa_salida: string;
  estado: string;
  numero_tanda?: number | null;
}

// --- Clientes ---
export interface Cliente {
  id: number;
  nombre: string;
  empresa?: string | null;
  contacto?: string | null;
  email?: string | null;
  telefono?: string | null;
  notas?: string | null;
  activo: number;
  fecha_creacion: string;
}

export interface ClienteCreate {
  nombre: string;
  empresa?: string | null;
  contacto?: string | null;
  email?: string | null;
  telefono?: string | null;
  notas?: string | null;
}

// --- Recepción ---
export interface RecepcionPayload {
  producto: Producto;
  variedad?: Variedad | null;
  cantidad_cajas_campo: number;
  cantidad_cajas_carton: number;
  tipo_cultivo_carton?: TipoCultivo | null;
  mercado: TipoMercado;
  // Limón specific
  lote?: string | null;
  cantidad_bins?: number;
  fecha_corte?: string | null;
}

// --- Empaque ---
export interface EmpaquePayload {
  producto: Producto;
  variedad?: Variedad | null;
  cantidad_cajas_campo_usadas?: number;
  tipo_cultivo?: TipoCultivo | null;
  mercado: TipoMercado;
  cantidad_cajas_carton_producidas?: number;
  porcentaje_merma?: number;
  notas_merma?: string | null;
  numero_empacador: string;
  // Limón
  bins_desverdizado_usados?: number;
  lote_desverdizado?: string | null;
  presentacion?: string | null;
  talla?: string | null;
  calidad?: string | null;
  cantidad_producida?: number;
  // New structured
  consumos_desverdizado?: Array<{lote: string; bins: number}>;
  cantidad_rpc12?: number;
  cantidad_rpc18?: number;
  cantidad_caja40lbs?: number;
  cantidad_bins_jugo?: number;
}

/** Registro de empaque (listado admin / correcciones) */
export interface EmpaqueRecord {
  id: number;
  fecha: string;
  producto: Producto;
  variedad?: Variedad | null;
  tipo_cultivo?: TipoCultivo | null;
  mercado: TipoMercado;
  cantidad_cajas_campo_usadas: number;
  cantidad_cajas_carton_producidas: number;
  porcentaje_merma: number;
  numero_empacador: string;
  bins_desverdizado_usados?: number | null;
  lote_desverdizado?: string | null;
  presentacion?: string | null;
  talla?: string | null;
  calidad?: string | null;
  cantidad_producida?: number | null;
  detalle_corrida?: {
    tipo?: string | null;
    consumos?: Array<{ lote: string; bins: number }>;
    consumos_granel?: Array<{
      presentacion?: string;
      talla?: string | null;
      cantidad: number;
    }>;
    produccion?: Array<{ presentacion: string; talla?: string | null; cantidad: number }>;
    bins_campo?: number;
    lotes_resumen?: string;
    anulado?: boolean;
    anulado_por?: string | null;
    notas?: string | null;
  } | null;
}

// --- Embarques ---
export interface EmbarqueDetalle {
  producto: Producto;
  variedad?: Variedad | null;
  tipo_cultivo?: TipoCultivo | null;
  mercado: TipoMercado;
  cantidad_cajas: number;
  // Limón
  presentacion?: string | null;
  talla?: string | null;
  calidad?: string | null;
}

export interface EmbarquePayload {
  cliente_id: number;
  notas?: string | null;
  detalles: EmbarqueDetalle[];
}

// --- Dashboard ---
export interface DashboardData {
  inventario_campo: InventarioCampoItem[];
  inventario_final: InventarioFinalItem[];
  desverdizado?: DesverdizadoItem[];
  embarques_recientes?: any[]; // podemos tipar mejor después
}

// --- Auth ---
export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface User {
  id: number;
  username: string;
  nombre_completo: string;
  rol: 'recepcion' | 'recepcion_empacador' | 'empacador' | 'embarques' | 'admin' | 'observador';
}

export interface UserCreate {
  username: string;
  nombre_completo: string;
  rol: User['rol'];
  password: string;
}
