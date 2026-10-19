import type { CSSProperties } from 'react';
import {
  useMelonPesos,
  variantesPesoMelon,
  type MelonPesosConfig,
} from '../../lib/melonPesos';
import { FILAS_CAJA_MELON } from '../../lib/constants';

/**
 * Pestaña admin: pesos de bin y de cada variante caja × talla.
 * Primera LLANO y Segunda Wallys pesan igual (un solo valor por variante).
 */
export default function AjustePesosMelon() {
  const { pesos, setPesos, guardar, restaurarDefaults } = useMelonPesos();
  const variantes = variantesPesoMelon();

  const setNum = (key: keyof MelonPesosConfig, value: string) => {
    const n = parseFloat(value);
    if (key === 'por_talla' || key === 'updated_at') return;
    setPesos({
      ...pesos,
      [key]: Number.isFinite(n) ? n : pesos[key],
    });
  };

  const setPesoTalla = (clave: string, value: string) => {
    const n = parseFloat(value);
    setPesos({
      ...pesos,
      por_talla: {
        ...pesos.por_talla,
        [clave]: Number.isFinite(n) && n > 0 ? n : pesos.por_talla[clave],
      },
    });
  };

  /** Copia el peso del tipo de caja a todas sus tallas. */
  const aplicarCajaATallas = (presentacion: string) => {
    const base =
      presentacion === 'caja_chica_a'
        ? pesos.caja_chica_a
        : presentacion === 'caja_jumbo_c'
          ? pesos.caja_jumbo_c
          : pesos.caja_normal_b;
    const next = { ...pesos.por_talla };
    for (const v of variantes) {
      if (v.presentacion === presentacion) next[v.key] = base;
    }
    setPesos({ ...pesos, por_talla: next });
  };

  const onGuardar = () => {
    const next = guardar();
    const nVar = Object.keys(next.por_talla || {}).length;
    alert(
      `✅ Pesos de melón guardados.\n` +
        `Bin ${next.bin_campo_kg} kg · ${nVar} variantes caja×talla.\n` +
        `LLANO y Wallys usan el mismo peso. Los reportes usarán estos valores.`
    );
  };

  const onRestaurar = () => {
    if (!confirm('¿Restaurar pesos provisionales por defecto?')) return;
    restaurarDefaults();
    alert('Pesos restaurados a los valores por defecto.');
  };

  const label: CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 4,
  };
  const input: CSSProperties = {
    width: '100%',
    maxWidth: 220,
    padding: '10px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 15,
  };
  const card: CSSProperties = {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  };

  return (
    <div style={{ background: 'white', padding: 25, borderRadius: 10, maxWidth: 880 }}>
      <h2 style={{ marginTop: 0 }}>Ajuste de pesos — Melón</h2>
      <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>
        Solo administradores. Define el peso del <strong>bin de campo</strong> y de cada{' '}
        <strong>caja × talla</strong> (#6s Jumbo, #9s Chica, etc.).{' '}
        <strong>Primera LLANO y Segunda Wallys pesan igual</strong> — un solo valor por variante.
      </p>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Bin de campo</h3>
        <label style={label}>Peso del bin (kg)</label>
        <input
          type="number"
          min={1}
          step={1}
          value={pesos.bin_campo_kg}
          onChange={(e) => setNum('bin_campo_kg', e.target.value)}
          style={input}
        />
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>
          Fallback por tipo de caja (si falta una talla)
        </h3>
        <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
          También puedes «Aplicar a tallas» para copiar ese peso a todas las tallas de esa caja.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 14,
          }}
        >
          {FILAS_CAJA_MELON.map((fila) => {
            const key = fila.presentacion as 'caja_chica_a' | 'caja_normal_b' | 'caja_jumbo_c';
            return (
              <div key={fila.presentacion}>
                <label style={label}>{fila.label} (kg / caja)</label>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={pesos[key]}
                  onChange={(e) => setNum(key, e.target.value)}
                  style={input}
                />
                <button
                  type="button"
                  onClick={() => aplicarCajaATallas(fila.presentacion)}
                  style={{
                    marginTop: 6,
                    padding: '6px 10px',
                    fontSize: 12,
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    background: '#fff',
                    cursor: 'pointer',
                    fontWeight: 600,
                    color: '#334155',
                  }}
                >
                  Aplicar a tallas
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Pesos por caja × talla</h3>
        <p style={{ fontSize: 12, color: '#64748b', marginTop: 0, marginBottom: 12 }}>
          Captura cada variante. Misma calidad LLANO/Wallys → mismo kg.
        </p>
        {FILAS_CAJA_MELON.map((fila) => (
          <div key={fila.presentacion} style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: fila.llano.title,
                marginBottom: 8,
              }}
            >
              {fila.label}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 10,
              }}
            >
              {variantes
                .filter((v) => v.presentacion === fila.presentacion)
                .map((v) => (
                  <div key={v.key}>
                    <label style={label}>{v.label} (kg)</label>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={pesos.por_talla[v.key] ?? ''}
                      onChange={(e) => setPesoTalla(v.key, e.target.value)}
                      style={{ ...input, maxWidth: '100%' }}
                    />
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      {pesos.updated_at && (
        <p style={{ fontSize: 12, color: '#64748b' }}>
          Última guardada: {new Date(pesos.updated_at).toLocaleString()}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
        <button
          type="button"
          onClick={onGuardar}
          style={{
            padding: '12px 22px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Guardar pesos
        </button>
        <button
          type="button"
          onClick={onRestaurar}
          style={{
            padding: '12px 18px',
            background: '#f1f5f9',
            color: '#334155',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Restaurar defaults
        </button>
      </div>
    </div>
  );
}
