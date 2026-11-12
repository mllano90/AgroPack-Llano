import { useEffect, useState } from 'react';
import AjustePesosMelon from '../AjustePesos/AjustePesosMelon';
import {
  KG_POR_PRESENTACION,
  PESO_BIN_CAMPO_KG,
  labelPresentacionLimon,
} from '../../lib/constants';
import {
  crearProductoCatalogo,
  listarProductosCatalogo,
  listarTiposCaja,
  listarTiposCosecha,
  mensajeError,
  type ProductoCatalogo,
  type TipoCaja,
  type TipoCosecha,
} from '../../lib/catalogoApi';
import ProductoConfigForm from './ProductoConfigForm';

interface Props {
  token: string;
}

const LIMON_1RA = ['rpc_12', 'rpc_18', 'caja_40lbs'] as const;
const LIMON_PARRILLA: Record<string, number> = {
  rpc_12: 45,
  rpc_18: 45,
  caja_40lbs: 63,
  bins_jugo: 1,
};

export default function AjustesGenerales({ token }: Props) {
  const [sel, setSel] = useState('melon');
  const [productos, setProductos] = useState<ProductoCatalogo[]>([]);
  const [tiposCaja, setTiposCaja] = useState<TipoCaja[]>([]);
  const [tiposCosecha, setTiposCosecha] = useState<TipoCosecha[]>([]);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [busy, setBusy] = useState(false);

  const cargar = async () => {
    const [prods, cajas, cosechas] = await Promise.all([
      listarProductosCatalogo(token),
      listarTiposCaja(token),
      listarTiposCosecha(token),
    ]);
    setProductos(prods);
    setTiposCaja(cajas);
    setTiposCosecha(cosechas);
    return prods;
  };

  useEffect(() => {
    cargar().catch((err) => console.warn('catalogo', mensajeError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const actual = productos.find((p) => `cat:${p.codigo}` === sel) || null;

  const registrarNombre = async () => {
    const nombre = nombreNuevo.trim();
    if (!nombre) return alert('Escribe el nombre del producto');
    setBusy(true);
    try {
      const creado = await crearProductoCatalogo(token, nombre);
      setNombreNuevo('');
      await cargar();
      setSel(`cat:${creado.codigo}`);
    } catch (err) {
      alert(mensajeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: 'white', padding: 25, borderRadius: 10 }}>
      <h2 style={{ marginTop: 0 }}>Ajustes generales</h2>
      <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>
        Elige el producto. Melón conserva el ajuste de pesos de siempre. Limón y uva muestran sus
        parámetros fijos. Un producto nuevo se registra por nombre y después se configura aquí.
      </p>

      <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
        Producto
      </label>
      <select
        value={sel}
        onChange={(e) => setSel(e.target.value)}
        style={{
          minWidth: 280,
          maxWidth: '100%',
          padding: '12px 14px',
          borderRadius: 8,
          border: '1px solid #cbd5e1',
          fontSize: 15,
          fontWeight: 700,
        }}
      >
        <option value="melon">Melón</option>
        <option value="limon">Limón</option>
        <option value="uva">Uva</option>
        {productos.map((p) => (
          <option key={p.id} value={`cat:${p.codigo}`}>
            {p.nombre}
            {p.activo ? '' : ' (inactivo)'}
          </option>
        ))}
        <option value="nuevo">Producto nuevo</option>
      </select>

      {sel === 'nuevo' && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={nombreNuevo}
            onChange={(e) => setNombreNuevo(e.target.value)}
            placeholder="Nombre del producto"
            style={{ padding: '12px', borderRadius: 8, border: '1px solid #cbd5e1', minWidth: 240 }}
          />
          <button
            type="button"
            onClick={registrarNombre}
            disabled={busy}
            style={{
              padding: '12px 16px',
              background: '#15803d',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Registrar
          </button>
        </div>
      )}

      {sel === 'melon' && (
        <div style={{ marginTop: 18 }}>
          <p style={{ fontSize: 14, marginBottom: 8 }}>
            <strong>Cosecha:</strong> Bin. Primera LLANO y segunda Wallys usan el mismo peso por caja
            y talla. Guardar escribe el mismo ajuste que la pantalla anterior y los reportes de melón
            lo siguen leyendo igual.
          </p>
          <AjustePesosMelon />
        </div>
      )}

      {sel === 'limon' && <LimonFijo />}
      {sel === 'uva' && <UvaFijo />}

      {actual && (
        <ProductoConfigForm
          key={`${actual.id}-${actual.peso_contenedor_kg ?? ''}-${actual.parametros.map((p) => `${p.id}:${p.kg}:${p.cajas_por_parrilla}`).join('|')}-${actual.activo}`}
          token={token}
          producto={actual}
          tiposCaja={tiposCaja}
          tiposCosecha={tiposCosecha}
          onTiposCaja={setTiposCaja}
          onTiposCosecha={setTiposCosecha}
          onSaved={(p) => setProductos((prev) => prev.map((x) => (x.id === p.id ? p : x)))}
          onDeleted={() => {
            setSel('melon');
            cargar().catch(() => {});
          }}
        />
      )}
    </div>
  );
}

function LimonFijo() {
  return (
    <div style={{ marginTop: 18 }}>
      <p style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, fontSize: 14 }}>
        Limón no se edita en esta pantalla. Estos son los valores fijos que ya usan Recepción, Empaque
        y Reportes.
      </p>
      <p>
        <strong>Cosecha:</strong> Bin
      </p>
      <p>
        <strong>Peso estimado del bin:</strong> {PESO_BIN_CAMPO_KG} kg
      </p>
      <TablaFija
        titulo="Empaque — primera (1ra)"
        filas={LIMON_1RA.map((codigo) => ({
          nombre: labelPresentacionLimon(codigo),
          kg: KG_POR_PRESENTACION[codigo],
          cajas: LIMON_PARRILLA[codigo],
        }))}
      />
      <TablaFija
        titulo="Empaque — segunda (2da)"
        filas={[
          {
            nombre: labelPresentacionLimon('bins_jugo'),
            kg: KG_POR_PRESENTACION.bins_jugo,
            cajas: LIMON_PARRILLA.bins_jugo,
          },
        ]}
      />
      <p style={{ fontSize: 12, color: '#64748b' }}>
        El RPC a granel ({KG_POR_PRESENTACION.rpc_granel} kg) es producto en proceso, no una presentación
        final. Parrilla RPC = 45 cajas, cartón = 63, bin de jugo = 1 parrilla.
      </p>
    </div>
  );
}

function UvaFijo() {
  return (
    <div style={{ marginTop: 18 }}>
      <p style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, fontSize: 14 }}>
        La uva no tiene ajuste de pesos. La recepción y el empaque siguen por variedad, mercado y número
        de cajas.
      </p>
      <p>
        <strong>Cosecha:</strong> Caja de campo
      </p>
      <p>
        <strong>Peso estimado:</strong> no aplica (el inventario de uva es en cajas, sin kilos por
        presentación).
      </p>
    </div>
  );
}

function TablaFija({
  titulo,
  filas,
}: {
  titulo: string;
  filas: Array<{ nombre: string; kg: number; cajas: number }>;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ fontSize: 15, marginBottom: 6 }}>{titulo}</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 560, fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#64748b' }}>
            <th style={{ padding: '6px 8px' }}>Tipo de caja</th>
            <th style={{ padding: '6px 8px' }}>Kg / caja</th>
            <th style={{ padding: '6px 8px' }}>Cajas por parrilla</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.nombre}>
              <td style={{ padding: '6px 8px', borderTop: '1px solid #e2e8f0' }}>{f.nombre}</td>
              <td style={{ padding: '6px 8px', borderTop: '1px solid #e2e8f0' }}>{f.kg}</td>
              <td style={{ padding: '6px 8px', borderTop: '1px solid #e2e8f0' }}>{f.cajas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
