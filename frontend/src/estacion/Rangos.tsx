import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import type { Config, Umbral } from './tipos';
import { Icono } from './Icono';

const ORDEN = ['t_aire', 'h_aire', 'pir', 't_caja', 'h_caja', 't_suelo', 'h_suelo', 'ec', 'ph', 'n', 'p', 'k'];
const aTexto = (v: number | null) => (v == null ? '' : String(v));
const aNum = (t: string): number | null => (t.trim() === '' ? null : Number(t.replace(',', '.')));

/** Error de validación de una fila (null = ok). Vacío = sin límite. */
export function errorRango(min: string, max: string): string | null {
  const a = aNum(min), b = aNum(max);
  if ((a != null && !Number.isFinite(a)) || (b != null && !Number.isFinite(b))) return 'Número inválido';
  if (a != null && b != null && a >= b) return 'Mín debe ser menor que Máx';
  return null;
}

/** Ajustes de rangos (máx/mín): visible para cualquier usuario autenticado. */
export default function Configuracion({ alGuardar, alSalir }: { alGuardar: () => void; alSalir: () => void }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [msg, setMsg] = useState('');
  const [txt, setTxt] = useState<Record<string, { min: string; max: string; activo: boolean }>>({});
  const cargarTxt = (u: Record<string, Umbral>) =>
    setTxt(Object.fromEntries(Object.entries(u).map(([k, x]) => [k, { min: aTexto(x.min), max: aTexto(x.max), activo: x.activo }])));
  useEffect(() => { api.config().then(c => { setCfg(c); cargarTxt(c.umbrales); }).catch(e => setMsg(e.message)); }, []);
  if (!cfg) return <section className="vista"><div className="vidrio bloque">{msg || 'Cargando…'}</div></section>;
  const fila = (k: string, campo: 'min' | 'max' | 'activo', val: string | boolean) => setTxt({ ...txt, [k]: { ...txt[k], [campo]: val } });
  const errores = Object.fromEntries(Object.entries(txt).map(([k, x]) => [k, errorRango(x.min, x.max)]));
  const hayError = Object.values(errores).some(Boolean);
  const claves = [...ORDEN.filter(k => k in txt), ...Object.keys(txt).filter(k => !ORDEN.includes(k))];
  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (hayError) { setMsg('✖ Revisa los rangos marcados'); return; }
    const umbrales = Object.fromEntries(Object.entries(txt).map(([k, x]) => {
      const min = aNum(x.min), max = aNum(x.max);
      return [k, { min, max, activo: x.activo && (min != null || max != null) }];
    }));
    try {
      const r = await api.guardarConfig({
        nombre_nodo: cfg.nombre_nodo, sin_datos_min: cfg.sin_datos_min, offline_min: cfg.offline_min,
        bateria_min_v: cfg.bateria_min_v, umbrales,
      });
      if (r?.config) { setCfg({ ...cfg, ...r.config }); cargarTxt(r.config.umbrales); }
      setMsg('✔ Guardado'); alGuardar();
    } catch (err) { setMsg('✖ ' + (err as Error).message); }
    setTimeout(() => setMsg(''), 4000);
  };
  return (
    <section id="v-rangos" className="vista">
      <form className="vidrio bloque" onSubmit={guardar}>
        <h2>Ajustes de rangos</h2>
        <p className="tenue chico">Se dibuja como líneas discontinuas Mín/Máx en todas las gráficas (ventana emergente, Historial y
          reportes) y se usa para alertas y "tiempo en rango". Deja vacío un límite si no lo conoces. Valores sugeridos: chile en casa sombra.</p>
        <div className="tabla-umb" id="tabla-rangos">
          <div className="u cab"><span>Parámetro</span><span>Mín</span><span>Máx</span><span title="Generar alerta al salir del rango">Alerta</span></div>
          {claves.map(k => {
            const x = txt[k], err = errores[k], un = cfg.variables[k]?.unidad;
            return (
              <div className={'u' + (err ? ' con-error' : '')} key={k} id={'rango-' + k}>
                <span>{cfg.variables[k]?.nombre ?? k} {un && <small>{un}</small>}</span>
                <input type="text" inputMode="decimal" placeholder="—" aria-label={`${cfg.variables[k]?.nombre} mínimo`} aria-invalid={!!err}
                  value={x.min} onChange={e => fila(k, 'min', e.target.value)} />
                <input type="text" inputMode="decimal" placeholder="—" aria-label={`${cfg.variables[k]?.nombre} máximo`} aria-invalid={!!err}
                  value={x.max} onChange={e => fila(k, 'max', e.target.value)} />
                <input type="checkbox" aria-label={`${cfg.variables[k]?.nombre}: alerta`} checked={x.activo && (x.min.trim() !== '' || x.max.trim() !== '')}
                  disabled={x.min.trim() === '' && x.max.trim() === ''} onChange={e => fila(k, 'activo', e.target.checked)} />
                {err && <em className="u-error" role="alert">{err}</em>}
              </div>
            );
          })}
        </div>
        <div className="acciones"><button className="btn primario" type="submit" disabled={hayError}>Guardar</button><span className="tenue">{msg}</span></div>
      </form>
      <div className="salir"><button className="btn" type="button" onClick={alSalir}><Icono id="salir" />Cerrar sesión</button></div>
    </section>
  );
}
