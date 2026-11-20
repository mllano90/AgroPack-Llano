import { useRef, useState, type CSSProperties } from 'react';
import {
  cambiarActivoProducto,
  configurarProducto,
  crearTipoCaja,
  crearTipoCosecha,
  eliminarProductoCatalogo,
  mensajeError,
  type CalidadCatalogo,
  type ProductoCatalogo,
  type TipoCaja,
  type TipoCosecha,
} from '../../lib/catalogoApi';

interface Row {
  key: string;
  tipoId: string;
  kg: string;
  cajas: string;
  nuevo: boolean;
  nuevoNombre: string;
}

interface FormaRow {
  key: string;
  codigo: string;
  peso: string;
  nuevo: boolean;
  nuevoNombre: string;
}

interface Props {
  token: string;
  producto: ProductoCatalogo;
  tiposCaja: TipoCaja[];
  tiposCosecha: TipoCosecha[];
  onTiposCaja: (rows: TipoCaja[]) => void;
  onTiposCosecha: (rows: TipoCosecha[]) => void;
  onSaved: (p: ProductoCatalogo) => void;
  onDeleted: () => void;
}

const input: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  fontSize: 14,
  boxSizing: 'border-box',
};

const label: CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 700,
  color: '#334155',
  marginBottom: 6,
};

function rowsIniciales(
  producto: ProductoCatalogo,
  calidad: CalidadCatalogo,
  keyOf: () => string
): Row[] {
  const mine = producto.parametros.filter((p) => p.calidad === calidad);
  if (mine.length === 0) {
    return [{ key: keyOf(), tipoId: '', kg: '', cajas: '', nuevo: false, nuevoNombre: '' }];
  }
  return mine.map((p) => ({
    key: keyOf(),
    tipoId: String(p.tipo_caja_id),
    kg: String(p.kg),
    cajas: String(p.cajas_por_parrilla),
    nuevo: false,
    nuevoNombre: '',
  }));
}

export default function ProductoConfigForm({
  token,
  producto,
  tiposCaja,
  tiposCosecha,
  onTiposCaja,
  onTiposCosecha,
  onSaved,
  onDeleted,
}: Props) {
  const seq = useRef(1);
  const keyOf = () => `r${seq.current++}`;
  const [formas, setFormas] = useState<FormaRow[]>(() => {
    const src = producto.formas?.length
      ? producto.formas
      : producto.peso_contenedor_kg
        ? [{ codigo: producto.tipo_cosecha, peso_kg: producto.peso_contenedor_kg }]
        : [];
    if (src.length === 0) {
      return [{ key: keyOf(), codigo: 'bins', peso: '', nuevo: false, nuevoNombre: '' }];
    }
    return src.map((f) => ({
      key: keyOf(),
      codigo: f.codigo,
      peso: String(f.peso_kg),
      nuevo: false,
      nuevoNombre: '',
    }));
  });
  const [ha, setHa] = useState(producto.hectareas != null ? String(producto.hectareas) : '');
  const [rows1, setRows1] = useState<Row[]>(() => rowsIniciales(producto, 'primera', keyOf));
  const [rows2, setRows2] = useState<Row[]>(() => rowsIniciales(producto, 'segunda', keyOf));
  const [busy, setBusy] = useState(false);

  const patchForma = (key: string, partial: Partial<FormaRow>) => {
    setFormas((prev) => prev.map((f) => (f.key === key ? { ...f, ...partial } : f)));
  };

  const registrarCosecha = async (key: string) => {
    const row = formas.find((f) => f.key === key);
    const nombre = row?.nuevoNombre.trim() || '';
    if (!nombre) return alert('Escribe el nombre del contenedor de cosecha');
    setBusy(true);
    try {
      const creado = await crearTipoCosecha(token, nombre);
      onTiposCosecha([...tiposCosecha.filter((t) => t.codigo !== creado.codigo), creado]);
      patchForma(key, { codigo: creado.codigo, nuevo: false, nuevoNombre: '' });
    } catch (err) {
      alert(mensajeError(err));
    } finally {
      setBusy(false);
    }
  };

  const registrarCaja = async (calidad: CalidadCatalogo, key: string) => {
    const rows = calidad === 'primera' ? rows1 : rows2;
    const setRows = calidad === 'primera' ? setRows1 : setRows2;
    const row = rows.find((r) => r.key === key);
    const nombre = row?.nuevoNombre.trim() || '';
    if (!nombre) return alert('Escribe el nombre del tipo de caja');
    setBusy(true);
    try {
      const creado = await crearTipoCaja(token, nombre);
      if (!tiposCaja.some((t) => t.id === creado.id)) onTiposCaja([...tiposCaja, creado]);
      setRows(
        rows.map((r) =>
          r.key === key ? { ...r, tipoId: String(creado.id), nuevo: false, nuevoNombre: '' } : r
        )
      );
    } catch (err) {
      alert(mensajeError(err));
    } finally {
      setBusy(false);
    }
  };

  const collect = (rows: Row[], calidad: CalidadCatalogo) => {
    const out: Array<{
      calidad: CalidadCatalogo;
      tipo_caja_id: number;
      kg: number;
      cajas_por_parrilla: number;
    }> = [];
    for (const row of rows) {
      const vacia = !row.tipoId && !row.kg.trim() && !row.cajas.trim() && !row.nuevo;
      if (vacia) continue;
      if (row.nuevo || !row.tipoId) {
        throw new Error('Elige un tipo de caja o regístralo antes de guardar');
      }
      const kg = Number(row.kg);
      const cajas = Number(row.cajas);
      if (!(kg > 0) || !Number.isInteger(cajas) || cajas < 1) {
        throw new Error('Cada tipo de caja necesita kilos y cuántas cajas hacen una parrilla');
      }
      out.push({
        calidad,
        tipo_caja_id: Number(row.tipoId),
        kg,
        cajas_por_parrilla: cajas,
      });
    }
    return out;
  };

  const guardar = async () => {
    let parametros;
    try {
      parametros = [...collect(rows1, 'primera'), ...collect(rows2, 'segunda')];
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Revisa los tipos de caja');
      return;
    }
    if (parametros.length === 0) {
      return alert('Agrega al menos un tipo de caja en 1ra o en 2da');
    }
    const formasOut: Array<{ codigo: string; peso_kg: number }> = [];
    for (const row of formas) {
      const vacia = !row.codigo && !row.peso.trim() && !row.nuevo;
      if (vacia) continue;
      if (row.nuevo || !row.codigo) {
        return alert('Elige cada forma de cosecha o regístrala antes de guardar');
      }
      const pesoN = Number(row.peso);
      if (!(pesoN > 0)) return alert('Cada forma de cosecha necesita su peso en kilos');
      formasOut.push({ codigo: row.codigo, peso_kg: pesoN });
    }
    if (formasOut.length === 0) return alert('Agrega al menos una forma de cosecha con su peso');
    if (new Set(formasOut.map((f) => f.codigo)).size !== formasOut.length) {
      return alert('No repitas la misma forma de cosecha');
    }
    let hectareas: number | null = null;
    if (ha.trim()) {
      hectareas = Number(ha);
      if (!(hectareas > 0)) return alert('Las hectáreas deben ser mayores a 0, o déjalas vacías');
    }
    setBusy(true);
    try {
      const saved = await configurarProducto(token, producto.id, {
        formas: formasOut,
        hectareas,
        parametros,
      });
      onSaved(saved);
      alert('Configuración guardada. Ya puedes usar el producto en Recepción, Empaque y Reportes.');
    } catch (err) {
      alert(mensajeError(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleActivo = async () => {
    setBusy(true);
    try {
      const saved = await cambiarActivoProducto(token, producto.id, !producto.activo);
      onSaved(saved);
    } catch (err) {
      alert(mensajeError(err));
    } finally {
      setBusy(false);
    }
  };

  const eliminar = async () => {
    if (!confirm(`¿Eliminar ${producto.nombre}? Solo se puede si aún no tiene movimientos.`)) return;
    setBusy(true);
    try {
      await eliminarProductoCatalogo(token, producto.id);
      onDeleted();
    } catch (err) {
      alert(mensajeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      {!producto.activo && (
        <p style={{ background: '#fef3c7', color: '#92400e', padding: 10, borderRadius: 8 }}>
          Este producto está inactivo: no aparece en Recepción ni Empaque.
        </p>
      )}
      {!producto.configurado && (
        <p style={{ background: '#eff6ff', color: '#1e3a8a', padding: 10, borderRadius: 8 }}>
          Falta guardar al menos una forma de cosecha con su peso y un tipo de caja.
        </p>
      )}

      <section style={bloque}>
        <h3 style={h3}>Cosecha</h3>
        <p style={{ ...ayuda, marginTop: 0 }}>
          Puede haber más de una forma (caja de campo y bin, u otras). Cada una lleva su propio peso.
          Bin y caja de campo ya vienen en la lista.
        </p>
        {formas.map((row) => {
          const nombre =
            tiposCosecha.find((t) => t.codigo === row.codigo)?.nombre || row.codigo || 'contenedor';
          return (
            <div key={row.key} style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(180px, 1.4fr) 180px auto',
                  gap: 8,
                  alignItems: 'end',
                }}
              >
                <div>
                  <label style={label}>Se cosecha en</label>
                  <select
                    value={row.nuevo ? '__nuevo__' : row.codigo}
                    onChange={(e) => {
                      if (e.target.value === '__nuevo__') patchForma(row.key, { nuevo: true, codigo: '' });
                      else patchForma(row.key, { nuevo: false, codigo: e.target.value });
                    }}
                    style={input}
                  >
                    <option value="">Elegir…</option>
                    {tiposCosecha.map((t) => (
                      <option key={t.codigo} value={t.codigo}>
                        {t.nombre}
                      </option>
                    ))}
                    <option value="__nuevo__">Registrar nuevo…</option>
                  </select>
                </div>
                <div>
                  <label style={label}>Kilos por {nombre.toLowerCase()}</label>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={row.peso}
                    onChange={(e) => patchForma(row.key, { peso: e.target.value })}
                    placeholder="Ej. 15"
                    style={input}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setFormas(formas.filter((f) => f.key !== row.key))}
                  style={btnGhost}
                >
                  Quitar
                </button>
              </div>
              {row.nuevo && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <input
                    value={row.nuevoNombre}
                    onChange={(e) => patchForma(row.key, { nuevoNombre: e.target.value })}
                    placeholder="Nombre del contenedor"
                    style={{ ...input, flex: 1, minWidth: 180 }}
                  />
                  <button type="button" onClick={() => registrarCosecha(row.key)} disabled={busy} style={btnSec}>
                    Registrar
                  </button>
                  <button type="button" onClick={() => patchForma(row.key, { nuevo: false })} style={btnGhost}>
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() =>
            setFormas([
              ...formas,
              { key: keyOf(), codigo: '', peso: '', nuevo: false, nuevoNombre: '' },
            ])
          }
          style={btnGhost}
        >
          Agregar forma de cosecha
        </button>
      </section>

      <BloqueCajas
        titulo="Empaque — primera (1ra)"
        detalle="Tipos de caja de primera calidad: kilos de cada caja y cuántas caben en una parrilla."
        rows={rows1}
        setRows={setRows1}
        tiposCaja={tiposCaja}
        busy={busy}
        onRegistrar={(key) => registrarCaja('primera', key)}
      />
      <BloqueCajas
        titulo="Empaque — segunda (2da)"
        detalle="La segunda calidad se configura aparte: puede usar otros tipos de caja, otros kilos y otra parrilla."
        rows={rows2}
        setRows={setRows2}
        tiposCaja={tiposCaja}
        busy={busy}
        onRegistrar={(key) => registrarCaja('segunda', key)}
      />

      <section style={bloque}>
        <h3 style={h3}>Hectáreas (opcional)</h3>
        <label style={label}>Superficie para ton/ha y kg/ha</label>
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={ha}
          onChange={(e) => setHa(e.target.value)}
          placeholder="Vacío si aún no aplica"
          style={{ ...input, maxWidth: 220 }}
        />
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" onClick={guardar} disabled={busy} style={btnPri}>
          {busy ? 'Guardando…' : 'Guardar configuración'}
        </button>
        <button type="button" onClick={toggleActivo} disabled={busy} style={btnSec}>
          {producto.activo ? 'Desactivar' : 'Activar'}
        </button>
        <button type="button" onClick={eliminar} disabled={busy} style={btnDanger}>
          Eliminar
        </button>
      </div>
    </div>
  );
}

function BloqueCajas({
  titulo,
  detalle,
  rows,
  setRows,
  tiposCaja,
  busy,
  onRegistrar,
}: {
  titulo: string;
  detalle: string;
  rows: Row[];
  setRows: (rows: Row[]) => void;
  tiposCaja: TipoCaja[];
  busy: boolean;
  onRegistrar: (key: string) => void;
}) {
  const seq = useRef(1);
  const patch = (key: string, partial: Partial<Row>) => {
    setRows(rows.map((r) => (r.key === key ? { ...r, ...partial } : r)));
  };
  return (
    <section style={bloque}>
      <h3 style={h3}>{titulo}</h3>
      <p style={{ ...ayuda, marginTop: 0 }}>{detalle}</p>
      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(180px, 1.4fr) 120px 150px auto',
            gap: 8,
            marginBottom: 8,
            alignItems: 'end',
          }}
        >
          <div>
            <label style={label}>Tipo de caja</label>
            <select
              value={row.nuevo ? '__nuevo__' : row.tipoId}
              onChange={(e) => {
                if (e.target.value === '__nuevo__') patch(row.key, { nuevo: true, tipoId: '' });
                else patch(row.key, { nuevo: false, tipoId: e.target.value });
              }}
              style={input}
            >
              <option value="">Elegir…</option>
              {tiposCaja.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
              <option value="__nuevo__">Registrar nuevo…</option>
            </select>
          </div>
          <div>
            <label style={label}>Kg / caja</label>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={row.kg}
              onChange={(e) => patch(row.key, { kg: e.target.value })}
              style={input}
            />
          </div>
          <div>
            <label style={label}>Cajas por parrilla</label>
            <input
              type="number"
              min={1}
              step={1}
              value={row.cajas}
              onChange={(e) => patch(row.key, { cajas: e.target.value })}
              style={input}
            />
          </div>
          <button
            type="button"
            onClick={() => setRows(rows.filter((r) => r.key !== row.key))}
            style={{ ...btnGhost, marginBottom: 2 }}
          >
            Quitar
          </button>
          {row.nuevo && (
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                value={row.nuevoNombre}
                onChange={(e) => patch(row.key, { nuevoNombre: e.target.value })}
                placeholder="Nombre del tipo de caja (se comparte con otros productos)"
                style={{ ...input, flex: 1, minWidth: 200 }}
              />
              <button type="button" disabled={busy} onClick={() => onRegistrar(row.key)} style={btnSec}>
                Registrar
              </button>
              <button type="button" onClick={() => patch(row.key, { nuevo: false })} style={btnGhost}>
                Cancelar
              </button>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setRows([
            ...rows,
            { key: `n${seq.current++}`, tipoId: '', kg: '', cajas: '', nuevo: false, nuevoNombre: '' },
          ])
        }
        style={btnGhost}
      >
        Agregar tipo de caja
      </button>
    </section>
  );
}

const bloque: CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: 16,
  marginBottom: 12,
};

const h3: CSSProperties = { margin: '0 0 8px', fontSize: 16 };
const ayuda: CSSProperties = { fontSize: 12, color: '#64748b', margin: '8px 0 0' };
const btnPri: CSSProperties = {
  padding: '12px 18px',
  background: '#15803d',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontWeight: 700,
  cursor: 'pointer',
};
const btnSec: CSSProperties = {
  padding: '10px 14px',
  background: '#fff',
  color: '#1e3a8a',
  border: '1px solid #93c5fd',
  borderRadius: 8,
  fontWeight: 700,
  cursor: 'pointer',
};
const btnGhost: CSSProperties = {
  padding: '10px 14px',
  background: '#fff',
  color: '#334155',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  fontWeight: 600,
  cursor: 'pointer',
};
const btnDanger: CSSProperties = {
  padding: '10px 14px',
  background: '#fff',
  color: '#b91c1c',
  border: '1px solid #fecaca',
  borderRadius: 8,
  fontWeight: 700,
  cursor: 'pointer',
};
