import { useEffect, useState, type CSSProperties } from 'react';
import {
  listarInventarioFinalAdmin,
  crearInventarioFinalAdmin,
  editarInventarioFinalAdmin,
  eliminarInventarioFinalAdmin,
  listarInventarioCampoAdmin,
  crearInventarioCampoAdmin,
  editarInventarioCampoAdmin,
  eliminarInventarioCampoAdmin,
  type InvFinalAdminItem,
  type InvCampoAdminItem,
} from '../../lib/api';
import {
  PRESENTACIONES_LIMON,
  TALLAS_LIMON,
  VARIEDADES,
  labelPresentacionLimon,
  tallasParaPresentacion,
} from '../../lib/constants';

interface Props {
  token: string;
  onChanged?: () => void;
}

type SubTab = 'final_limon' | 'final_uva' | 'campo';

export default function InventariosAdmin({ token, onChanged }: Props) {
  const [sub, setSub] = useState<SubTab>('final_limon');
  const [finales, setFinales] = useState<InvFinalAdminItem[]>([]);
  const [campo, setCampo] = useState<InvCampoAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  // edición inline final
  const [editId, setEditId] = useState<number | null>(null);
  const [editCant, setEditCant] = useState('');
  const [editMercado, setEditMercado] = useState('nacional');
  const [editTalla, setEditTalla] = useState('');
  const [editPres, setEditPres] = useState('');

  // alta limón
  const [nPres, setNPres] = useState('rpc_18');
  const [nTalla, setNTalla] = useState('140');
  const [nCant, setNCant] = useState('');
  const [nMercado, setNMercado] = useState('nacional');

  // alta uva final
  const [uVar, setUVar] = useState('early_sweet');
  const [uCult, setUCult] = useState('convencional');
  const [uMerc, setUMerc] = useState('nacional');
  const [uCant, setUCant] = useState('');

  // alta campo
  const [cVar, setCVar] = useState('early_sweet');
  const [cMerc, setCMerc] = useState('nacional');
  const [cCant, setCCant] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [f, c] = await Promise.all([
        listarInventarioFinalAdmin(token),
        listarInventarioCampoAdmin(token),
      ]);
      setFinales(Array.isArray(f) ? f : []);
      setCampo(Array.isArray(c) ? c : []);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo cargar inventarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  const limonRows = finales.filter(
    (r) => r.producto === 'limon_amarillo' || !!r.presentacion
  );
  const uvaRows = finales.filter(
    (r) => r.producto === 'uva' || (!r.presentacion && r.producto !== 'limon_amarillo')
  );

  const afterChange = async (msg: string) => {
    setOk(msg);
    setEditId(null);
    await load();
    onChanged?.();
  };

  const startEditFinal = (r: InvFinalAdminItem) => {
    setEditId(r.id);
    setEditCant(String(r.cantidad_stock));
    setEditMercado(r.mercado || 'nacional');
    setEditTalla(r.talla || '');
    setEditPres(r.presentacion || '');
    setOk('');
    setError('');
  };

  const saveEditFinal = async () => {
    if (editId == null) return;
    const cant = parseInt(editCant, 10);
    if (isNaN(cant) || cant < 0) return alert('Cantidad inválida (≥ 0)');
    setBusy(true);
    setError('');
    try {
      await editarInventarioFinalAdmin(token, editId, {
        cantidad_stock: cant,
        mercado: editMercado,
        presentacion: editPres || null,
        talla: editTalla || null,
      });
      await afterChange(`Inventario final #${editId} actualizado`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const removeFinal = async (id: number) => {
    if (!confirm(`¿Eliminar inventario final #${id}? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    setError('');
    try {
      const res = await eliminarInventarioFinalAdmin(token, id);
      await afterChange(res.message || `Eliminado #${id}`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo eliminar');
    } finally {
      setBusy(false);
    }
  };

  const addLimon = async () => {
    const cant = parseInt(nCant, 10);
    if (isNaN(cant) || cant < 0) return alert('Cantidad inválida');
    if (!nPres) return alert('Elige presentación');
    const tallas = tallasParaPresentacion(nPres);
    if (tallas.length > 0 && !nTalla) return alert('Elige talla');
    setBusy(true);
    setError('');
    try {
      const res = await crearInventarioFinalAdmin(token, {
        producto: 'limon_amarillo',
        mercado: nMercado,
        cantidad_stock: cant,
        presentacion: nPres,
        talla: nPres === 'bins_jugo' ? null : nTalla || null,
      });
      setNCant('');
      await afterChange(
        `Agregado: ${labelPresentacionLimon(res.presentacion || nPres)}` +
          (res.talla ? ` #${res.talla}` : '') +
          ` × ${res.cantidad_stock}`
      );
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo agregar');
    } finally {
      setBusy(false);
    }
  };

  const addUvaFinal = async () => {
    const cant = parseInt(uCant, 10);
    if (isNaN(cant) || cant < 0) return alert('Cantidad inválida');
    setBusy(true);
    setError('');
    try {
      await crearInventarioFinalAdmin(token, {
        producto: 'uva',
        mercado: uMerc,
        cantidad_stock: cant,
        variedad: uVar,
        tipo_cultivo: uCult,
      });
      setUCant('');
      await afterChange(`Agregado final uva ${uVar} × ${cant}`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo agregar');
    } finally {
      setBusy(false);
    }
  };

  const startEditCampo = (r: InvCampoAdminItem) => {
    setEditId(r.id);
    setEditCant(String(r.cantidad_disponible));
    setEditMercado(r.mercado || 'nacional');
    setOk('');
  };

  const saveEditCampo = async () => {
    if (editId == null) return;
    const cant = parseInt(editCant, 10);
    if (isNaN(cant) || cant < 0) return alert('Cantidad inválida');
    setBusy(true);
    try {
      await editarInventarioCampoAdmin(token, editId, {
        cantidad_disponible: cant,
        mercado: editMercado,
      });
      await afterChange(`Inventario campo #${editId} actualizado`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const removeCampo = async (id: number) => {
    if (!confirm(`¿Eliminar inventario de campo #${id}?`)) return;
    setBusy(true);
    try {
      const res = await eliminarInventarioCampoAdmin(token, id);
      await afterChange(res.message || `Eliminado #${id}`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo eliminar');
    } finally {
      setBusy(false);
    }
  };

  const addCampo = async () => {
    const cant = parseInt(cCant, 10);
    if (isNaN(cant) || cant < 0) return alert('Cantidad inválida');
    setBusy(true);
    try {
      await crearInventarioCampoAdmin(token, {
        variedad: cVar,
        mercado: cMerc,
        cantidad_disponible: cant,
      });
      setCCant('');
      await afterChange(`Campo ${cVar} actualizado a ${cant}`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo agregar');
    } finally {
      setBusy(false);
    }
  };

  const tabBtn = (id: SubTab): CSSProperties => ({
    padding: '8px 14px',
    borderRadius: 6,
    border: sub === id ? '2px solid #15803d' : '1px solid #cbd5e1',
    background: sub === id ? '#dcfce7' : '#fff',
    color: '#0f172a',
    fontWeight: 600,
    cursor: 'pointer',
  });

  const tallasAlta = tallasParaPresentacion(nPres);

  return (
    <div
      style={{
        marginTop: 8,
        padding: 20,
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        background: '#fafafa',
      }}
    >
      <h3 style={{ marginTop: 0 }}>Inventarios — corrección manual</h3>
      <p style={{ fontSize: 13, color: '#64748b', marginTop: 0, maxWidth: 720 }}>
        Ajusta stock final (limón / uva) o de campo. Los cambios son inmediatos en Dashboard y
        Embarques. Usa con cuidado: no crea historial de empaque/embarque.
      </p>

      {error && (
        <p style={{ color: '#dc2626', background: '#fef2f2', padding: 10, borderRadius: 8 }}>
          {error}
        </p>
      )}
      {ok && (
        <p style={{ color: '#15803d', background: '#f0fdf4', padding: 10, borderRadius: 8 }}>
          {ok}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button type="button" style={tabBtn('final_limon')} onClick={() => { setSub('final_limon'); setEditId(null); }}>
          Final limón
        </button>
        <button type="button" style={tabBtn('final_uva')} onClick={() => { setSub('final_uva'); setEditId(null); }}>
          Final uva
        </button>
        <button type="button" style={tabBtn('campo')} onClick={() => { setSub('campo'); setEditId(null); }}>
          Campo uva
        </button>
        <button
          type="button"
          onClick={load}
          style={{ padding: '8px 14px', cursor: 'pointer' }}
          disabled={loading}
        >
          Actualizar
        </button>
      </div>

      {loading ? (
        <p>Cargando inventarios…</p>
      ) : (
        <>
          {/* ===== FINAL LIMÓN ===== */}
          {sub === 'final_limon' && (
            <>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  marginBottom: 16,
                  padding: 14,
                  background: '#fff',
                  border: '1px solid #bae6fd',
                  borderRadius: 8,
                  alignItems: 'flex-end',
                }}
              >
                <strong style={{ width: '100%', fontSize: 13 }}>Agregar stock limón</strong>
                <label style={lab}>
                  Presentación
                  <select
                    value={nPres}
                    onChange={(e) => {
                      setNPres(e.target.value);
                      const ts = tallasParaPresentacion(e.target.value);
                      setNTalla(ts[0] || '');
                    }}
                    style={inp}
                  >
                    {PRESENTACIONES_LIMON.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                {tallasAlta.length > 0 && (
                  <label style={lab}>
                    Talla
                    <select value={nTalla} onChange={(e) => setNTalla(e.target.value)} style={inp}>
                      {tallasAlta.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label style={lab}>
                  Mercado
                  <select value={nMercado} onChange={(e) => setNMercado(e.target.value)} style={inp}>
                    <option value="nacional">nacional</option>
                    <option value="exportacion">exportacion</option>
                  </select>
                </label>
                <label style={lab}>
                  Cantidad
                  <input
                    type="number"
                    min={0}
                    value={nCant}
                    onChange={(e) => setNCant(e.target.value)}
                    style={{ ...inp, width: 100 }}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={addLimon}
                  style={btnPrimary}
                >
                  Agregar
                </button>
              </div>

              <table style={table}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={th}>ID</th>
                    <th style={th}>Presentación</th>
                    <th style={th}>Talla</th>
                    <th style={th}>Mercado</th>
                    <th style={th}>Stock</th>
                    <th style={th}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {limonRows.length === 0 && (
                    <tr>
                      <td colSpan={6} style={td}>
                        Sin stock de limón.
                      </td>
                    </tr>
                  )}
                  {limonRows.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>#{r.id}</td>
                      <td style={td}>
                        {editId === r.id ? (
                          <select
                            value={editPres}
                            onChange={(e) => setEditPres(e.target.value)}
                            style={inp}
                          >
                            {PRESENTACIONES_LIMON.map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.value}
                              </option>
                            ))}
                          </select>
                        ) : (
                          labelPresentacionLimon(r.presentacion || '')
                        )}
                      </td>
                      <td style={td}>
                        {editId === r.id ? (
                          <select
                            value={editTalla}
                            onChange={(e) => setEditTalla(e.target.value)}
                            style={inp}
                          >
                            <option value="">—</option>
                            {TALLAS_LIMON.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        ) : (
                          r.talla || '—'
                        )}
                      </td>
                      <td style={td}>
                        {editId === r.id ? (
                          <select
                            value={editMercado}
                            onChange={(e) => setEditMercado(e.target.value)}
                            style={inp}
                          >
                            <option value="nacional">nacional</option>
                            <option value="exportacion">exportacion</option>
                          </select>
                        ) : (
                          r.mercado
                        )}
                      </td>
                      <td style={td}>
                        {editId === r.id ? (
                          <input
                            type="number"
                            min={0}
                            value={editCant}
                            onChange={(e) => setEditCant(e.target.value)}
                            style={{ ...inp, width: 90 }}
                          />
                        ) : (
                          <strong>{r.cantidad_stock}</strong>
                        )}
                      </td>
                      <td style={td}>
                        {editId === r.id ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" disabled={busy} onClick={saveEditFinal} style={btnPrimary}>
                              Guardar
                            </button>
                            <button type="button" onClick={() => setEditId(null)} style={btnGhost}>
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" disabled={busy} onClick={() => startEditFinal(r)} style={btnBlue}>
                              Editar
                            </button>
                            <button type="button" disabled={busy} onClick={() => removeFinal(r.id)} style={btnRed}>
                              Borrar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* ===== FINAL UVA ===== */}
          {sub === 'final_uva' && (
            <>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  marginBottom: 16,
                  padding: 14,
                  background: '#fff',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  alignItems: 'flex-end',
                }}
              >
                <strong style={{ width: '100%', fontSize: 13 }}>Agregar stock final uva</strong>
                <label style={lab}>
                  Variedad
                  <select value={uVar} onChange={(e) => setUVar(e.target.value)} style={inp}>
                    {VARIEDADES.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={lab}>
                  Cultivo
                  <select value={uCult} onChange={(e) => setUCult(e.target.value)} style={inp}>
                    <option value="convencional">convencional</option>
                    <option value="organica">organica</option>
                  </select>
                </label>
                <label style={lab}>
                  Mercado
                  <select value={uMerc} onChange={(e) => setUMerc(e.target.value)} style={inp}>
                    <option value="nacional">nacional</option>
                    <option value="exportacion">exportacion</option>
                  </select>
                </label>
                <label style={lab}>
                  Cantidad
                  <input
                    type="number"
                    min={0}
                    value={uCant}
                    onChange={(e) => setUCant(e.target.value)}
                    style={{ ...inp, width: 100 }}
                  />
                </label>
                <button type="button" disabled={busy} onClick={addUvaFinal} style={btnPrimary}>
                  Agregar
                </button>
              </div>

              <table style={table}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={th}>ID</th>
                    <th style={th}>Variedad</th>
                    <th style={th}>Cultivo</th>
                    <th style={th}>Mercado</th>
                    <th style={th}>Stock</th>
                    <th style={th}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {uvaRows.length === 0 && (
                    <tr>
                      <td colSpan={6} style={td}>
                        Sin stock final de uva.
                      </td>
                    </tr>
                  )}
                  {uvaRows.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>#{r.id}</td>
                      <td style={td}>{r.variedad || '—'}</td>
                      <td style={td}>{r.tipo_cultivo || '—'}</td>
                      <td style={td}>{r.mercado}</td>
                      <td style={td}>
                        {editId === r.id ? (
                          <input
                            type="number"
                            min={0}
                            value={editCant}
                            onChange={(e) => setEditCant(e.target.value)}
                            style={{ ...inp, width: 90 }}
                          />
                        ) : (
                          <strong>{r.cantidad_stock}</strong>
                        )}
                      </td>
                      <td style={td}>
                        {editId === r.id ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" disabled={busy} onClick={saveEditFinal} style={btnPrimary}>
                              Guardar
                            </button>
                            <button type="button" onClick={() => setEditId(null)} style={btnGhost}>
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => startEditFinal(r)}
                              style={btnBlue}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => removeFinal(r.id)}
                              style={btnRed}
                            >
                              Borrar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* ===== CAMPO UVA ===== */}
          {sub === 'campo' && (
            <>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  marginBottom: 16,
                  padding: 14,
                  background: '#fff',
                  border: '1px solid #fde68a',
                  borderRadius: 8,
                  alignItems: 'flex-end',
                }}
              >
                <strong style={{ width: '100%', fontSize: 13 }}>
                  Agregar / fijar stock de campo (si ya existe variedad+mercado, actualiza cantidad)
                </strong>
                <label style={lab}>
                  Variedad
                  <select value={cVar} onChange={(e) => setCVar(e.target.value)} style={inp}>
                    {VARIEDADES.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={lab}>
                  Mercado
                  <select value={cMerc} onChange={(e) => setCMerc(e.target.value)} style={inp}>
                    <option value="nacional">nacional</option>
                    <option value="exportacion">exportacion</option>
                  </select>
                </label>
                <label style={lab}>
                  Cantidad
                  <input
                    type="number"
                    min={0}
                    value={cCant}
                    onChange={(e) => setCCant(e.target.value)}
                    style={{ ...inp, width: 100 }}
                  />
                </label>
                <button type="button" disabled={busy} onClick={addCampo} style={btnPrimary}>
                  Guardar stock
                </button>
              </div>

              <table style={table}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={th}>ID</th>
                    <th style={th}>Variedad</th>
                    <th style={th}>Mercado</th>
                    <th style={th}>Disponible</th>
                    <th style={th}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {campo.length === 0 && (
                    <tr>
                      <td colSpan={5} style={td}>
                        Sin inventario de campo.
                      </td>
                    </tr>
                  )}
                  {campo.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>#{r.id}</td>
                      <td style={td}>{r.variedad}</td>
                      <td style={td}>{r.mercado}</td>
                      <td style={td}>
                        {editId === r.id ? (
                          <input
                            type="number"
                            min={0}
                            value={editCant}
                            onChange={(e) => setEditCant(e.target.value)}
                            style={{ ...inp, width: 90 }}
                          />
                        ) : (
                          <strong>{r.cantidad_disponible}</strong>
                        )}
                      </td>
                      <td style={td}>
                        {editId === r.id ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" disabled={busy} onClick={saveEditCampo} style={btnPrimary}>
                              Guardar
                            </button>
                            <button type="button" onClick={() => setEditId(null)} style={btnGhost}>
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => startEditCampo(r)}
                              style={btnBlue}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => removeCampo(r.id)}
                              style={btnRed}
                            >
                              Borrar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: 'white',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  fontSize: 14,
};

const th: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #e2e8f0',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 13,
};

const td: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #f1f5f9',
};

const lab: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  fontSize: 12,
  gap: 4,
  color: '#334155',
};

const inp: CSSProperties = {
  padding: 8,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: 'white',
  color: '#0f172a',
};

const btnPrimary: CSSProperties = {
  padding: '8px 14px',
  background: '#15803d',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
};

const btnBlue: CSSProperties = {
  padding: '6px 10px',
  background: '#0369a1',
  color: 'white',
  border: 'none',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};

const btnRed: CSSProperties = {
  padding: '6px 10px',
  background: '#dc2626',
  color: 'white',
  border: 'none',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};

const btnGhost: CSSProperties = {
  padding: '8px 12px',
  background: '#f1f5f9',
  color: '#334155',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  cursor: 'pointer',
};
