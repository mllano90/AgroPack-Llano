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
  const [tipo, setTipo] = useState(producto.tipo_cosecha || 'bins');
  const [nuevaCosecha, setNuevaCosecha] = useState(false);
  const [nombreCosecha, setNombreCosecha] = useState('');
  const [peso, setPeso] = useState(
    producto.peso_contenedor_kg != null ? String(producto.peso_contenedor_kg) : ''
  );
  const [ha, setHa] = useState(producto.hectareas != null ? String(producto.hectareas) : '');
  const [rows1, setRows1] = useState<Row[]>(() => rowsIniciales(producto, 'primera', keyOf));
  const [rows2, setRows2] = useState<Row[]>(() => rowsIniciales(producto, 'segunda', keyOf));
  const [busy, setBusy] = useState(false);

  const cosechaNombre =
    tiposCosecha.find((t) => t.codigo === tipo)?.nombre || producto.tipo_cosecha_nombre || 'contenedor';

  const registrarCosecha = async () => {
    const nombre = nombreCosecha.trim();
    if (!nombre) return alert('Escribe el nombre del contenedor de cosecha');
    setBusy(true);
    try {
      const creado = await crearTipoCosecha(token, nombre);
      onTiposCosecha([...tiposCosecha.filter((t) => t.codigo !== creado.codigo), creado]);
      setTipo(creado.codigo);
      setNuevaCosecha(false);
      setNombreCosecha('');
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
    const pesoN = Number(peso);
    if (!(pesoN > 0)) return alert('Indica el peso estimado del contenedor de cosecha');
    let hectareas: number | null = null;
    if (ha.trim()) {
      hectareas = Number(ha);
      if (!(hectareas > 0)) return alert('Las hectáreas deben ser mayores a 0, o déjalas vacías');
    }
    if (nuevaCosecha) return alert('Termina de registrar el contenedor de cosecha, o cancela');
    setBusy(true);
    try {
      const saved = await configurarProducto(token, producto.id, {
        tipo_cosecha: tipo,
        peso_contenedor_kg: pesoN,
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
          Falta guardar el peso y al menos un tipo de caja para usarlo en Recepción y Empaque.
        </p>
      )}

      <section style={bloque}>
        <h3 style={h3}>Cosecha</h3>
        <label style={label}>Se cosecha en</label>
        <select
          value={nuevaCosecha ? '__nuevo__' : tipo}
          onChange={(e) => {
            if (e.target.value === '__nuevo__') setNuevaCosecha(true);
            else {
              setNuevaCosecha(false);
              setTipo(e.target.value);
            }
          }}
          style={input}
        >
          {tiposCosecha.map((t) => (
            <option key={t.codigo} value={t.codigo}>
              {t.nombre}
            </option>
          ))}
          <option value="__nuevo__">Registrar nuevo…</option>
        </select>
        {nuevaCosecha && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <input
              value={nombreCosecha}
              onChange={(e) => setNombreCosecha(e.target.value)}
              placeholder="Nombre del contenedor"
              style={{ ...input, flex: 1, minWidth: 180 }}
            />
            <button type="button" onClick={registrarCosecha} disabled={busy} style={btnSec}>
              Registrar
            </button>
            <button type="button" onClick={() => setNuevaCosecha(false)} style={btnGhost}>
              Cancelar
            </button>
          </div>
        )}
        <p style={ayuda}>
          Bin y caja de campo ya vienen en la lista. Si registras otro, queda disponible para el resto
          de productos.
        </p>
      </section>

      <section style={bloque}>
        <h3 style={h3}>Peso estimado del {cosechaNombre.toLowerCase()}</h3>
        <label style={label}>Kilos por {cosechaNombre.toLowerCase()}</label>
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={peso}
          onChange={(e) => setPeso(e.target.value)}
          placeholder="Ej. 260"
          style={{ ...input, maxWidth: 220 }}
        />
        <p style={ayuda}>
          Con este peso se calculan los kilos de campo, el % de 1ra y 2da, y las toneladas por hectárea.
        </p>
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
