export interface Sensor { ok: boolean; error: string | null; codigo: number; t?: number | null; h?: number | null; v?: number | null; ts?: number | null }
export interface Umbral { min: number; max: number; activo: boolean }
export interface Ultimo {
  nodo: string; nombre_nodo: string; ahora: number; alertas_activas: number; offline_min: number;
  hay_datos: boolean; en_linea: boolean; umbrales: Record<string, Umbral>;
  receptora: { firmware?: string | null; cola_pendiente?: number | null; ts: number } | null;
  ts?: number; seq?: number; tipo?: string; rssi?: number | null; snr?: number | null; sin_hora_emisora?: boolean;
  aire?: { a1: Sensor; a2: Sensor; t: number | null; h: number | null };
  pir?: Sensor; suelo?: Sensor;
  npk?: { ec: number; ph: number; n: number; p: number; k: number; ts: number; n_npk: number } | null;
  npk_ultimo_fallo?: boolean; fase?: { fase: number; min: number; tot: number };
}
export interface Punto { t: number; prom: number; min: number; max: number; n: number }
export interface Historial { var: string; rango: string; paso_s: number; fuente: string; desde: number; hasta: number; puntos: Punto[] }
export interface Config {
  nombre_nodo: string; sin_datos_min: number; offline_min: number; bateria_min_v: number;
  umbrales: Record<string, Umbral>; variables: Record<string, { nombre: string; unidad: string }>;
}
export interface Alerta { id: number; clave: string; tipo: string; mensaje: string; estado: string; inicio: number; ultima: number; fin: number | null; conteo: number }
export interface Comando {
  id: number; nodo: string; tipo: string; parametros: { duracion_min: number }; estado: string; estado_texto: string;
  creado: number; actualizado: number; detalle: string | null; usuario: string | null; expira: number | null;
}
