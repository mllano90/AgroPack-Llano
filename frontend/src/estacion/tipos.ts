export interface Sensor { ok: boolean; error: string | null; codigo: number; t?: number | null; h?: number | null; v?: number | null; ts?: number | null }
export interface Umbral { min: number | null; max: number | null; activo: boolean }
export interface Ultimo {
  nodo: string; nombre_nodo: string; ahora: number; alertas_activas: number; offline_min: number;
  hay_datos: boolean; en_linea: boolean; umbrales: Record<string, Umbral>;
  /** µmol/m²/s por W/m². Lo leen admin y usuario normal; solo el admin lo cambia. */
  factor_par?: number; par_actual?: number | null; dli_hoy?: number | null;
  receptora: { firmware?: string | null; cola_pendiente?: number | null; ts: number } | null;
  ts?: number; seq?: number; tipo?: string; rssi?: number | null; snr?: number | null; sin_hora_emisora?: boolean;
  aire?: { a1: Sensor; a2: Sensor; t: number | null; h: number | null };
  /** Lectura en vivo de la caja interna. Inicio no la muestra; Configuración admin sí. */
  interno?: Sensor | null;
  caja_condensacion_pct?: number | null;
  caja_punto_rocio?: number | null;
  pir?: Sensor; suelo?: Sensor;
  npk?: { ec: number; ph: number; n: number; p: number; k: number; ts: number; n_npk: number } | null;
  npk_ultimo_fallo?: boolean; fase?: { fase: number; min: number; tot: number };
}
export interface Punto { t: number; prom: number; min: number; max: number; n: number }
export interface ExtremoPeriodo { min: number; max: number; min_s: number; max_s: number; min_min: number; max_min: number }
export interface Historial {
  var: string; rango: string; paso_s: number; fuente: string; desde: number; hasta: number; puntos: Punto[]; extremo?: ExtremoPeriodo | null;
  factor_par?: number; dli_hoy?: number | null; dli_promedio?: number | null;
}
export interface Config {
  nombre_nodo: string; sin_datos_min: number; offline_min: number; bateria_min_v: number; factor_par?: number;
  rango_banda?: boolean;
  umbrales: Record<string, Umbral>; sugeridos?: Record<string, Umbral>;
  variables: Record<string, { nombre: string; unidad: string }>;
}
export interface ExtremoDia { max: number; min: number; ts_max: number; ts_min: number; s_max: number; s_min: number; banda: number; paso_s: number; n: number }
export interface ResumenDia { nodo: string; zona: string; desde: number; hasta: number; vars: Record<string, ExtremoDia | null> }
export interface Alerta { id: number; clave: string; tipo: string; mensaje: string; estado: string; inicio: number; ultima: number; fin: number | null; conteo: number }
export interface Cuenta { usuario: string; rol: 'admin' | 'normal'; activo: boolean; creado: number }
export interface Comando {
  id: number; nodo: string; tipo: string;
  parametros: { duracion_min?: number; ssid?: string; url?: string; clave?: string; accion?: string; n?: number };
  estado: string; estado_texto: string;
  creado: number; actualizado: number; detalle: string | null; usuario: string | null; expira: number | null;
}
export interface Resumen { min: number; max: number; prom: number; n: number; en_rango_pct?: number | null }
export interface VarReporte {
  nombre: string; unidad: string; fuente: string; resumen: Resumen | null; puntos: Punto[];
  umbral?: Umbral | null; extras: Record<string, Punto[]>;
}
export interface Reporte {
  nodo: string; nombre_nodo: string; rango: string; generado: number; desde: number; hasta: number; paso_s: number;
  fuente: string; orden: string[]; variables: Record<string, VarReporte>; rango_banda?: boolean;
}
export interface FallbackCanal { desde: number; hacia: number; motivo: string; hace_s: number }
export interface CanalLora {
  activo: number; fabrica: boolean; mhz: number; sf: number; bw_khz: number; confirmado: boolean;
  anterior: number; sin_paquetes_s: number; fallback: FallbackCanal | null;
}
export interface FilaEnlace {
  n: number; mhz: number; sf: number; bw_khz: number; toa_ms?: number; limite_snr_db?: number; probada?: boolean;
  enviados?: number; recibidos?: number; perdida_pct?: number | null; rssi_prom?: number | null;
  snr_prom?: number | null; margen_snr_db?: number | null; apta?: string;
}
export interface PruebaEnlace {
  estado: 'inactiva' | 'esperando_ack' | 'en_curso' | 'terminada'; comando_id: number; combinacion: number; total: number;
  fin?: string; fin_texto?: string; recomendada?: number | null; alternativa_poco_margen?: number | null;
  tabla: FilaEnlace[]; version_emisora?: string | null; duracion_s?: number;
}
export interface EstadoEnlace {
  nodo: string; firmware: string | null; token_configurado: boolean;
  canal_lora: CanalLora | null; prueba_enlace: PruebaEnlace | null; comandos: Comando[];
}
export interface EstadoWifi {
  nodo: string; token_configurado: boolean; comandos: Comando[];
  receptora: { ssid: string; fuente: string | null; clave: 'configurada' | 'vacía'; firmware: string | null; ts: number } | null;
}
