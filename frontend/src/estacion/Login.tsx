import { useState, type FormEvent } from 'react';
import { api } from './api';
import { Icono } from './Icono';

export default function Login({ alEntrar }: { alEntrar: (token: string) => void }) {
  const [u, setU] = useState('');
  const [c, setC] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault(); setEnviando(true); setError('');
    try { alEntrar((await api.login(u, c)).token); } catch (err) { setError((err as Error).message); }
    setEnviando(false);
  };
  return (
    <div className="pagina-login">
      <div className="fondo" />
      <form className="vidrio login" onSubmit={enviar}>
        <div className="login-logo"><Icono id="hoja" className="ico hoja" /></div>
        <h1>Estación Pimiento</h1>
        <p className="tenue">Ingresa para ver tu cultivo</p>
        {error && <p className="error-login">{error}</p>}
        <label>Usuario<input name="usuario" autoComplete="username" required autoFocus value={u} onChange={e => setU(e.target.value)} /></label>
        <label>Contraseña<input name="clave" type="password" autoComplete="current-password" required value={c} onChange={e => setC(e.target.value)} /></label>
        <button className="btn primario" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
