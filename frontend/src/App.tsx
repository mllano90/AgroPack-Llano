import { useState, useEffect, type CSSProperties } from 'react';
import Embarques from './components/Embarques/Embarques';
import Dashboard from './components/Dashboard/Dashboard';
import Empaque from './components/Empaque/Empaque';
import Recepcion from './components/Recepcion/Recepcion';
import Usuarios from './components/Usuarios/Usuarios';
import Reportes from './components/Reportes/Reportes';
import Correcciones from './components/Correcciones/Correcciones';

import { login, getCurrentUser } from './lib/api';
import { useDashboard } from './hooks/useDashboard';
import { useClientes } from './hooks/useClientes';
import type { User } from './types';

type TabId = 'recepcion' | 'empaque' | 'embarques' | 'usuarios' | 'dashboard' | 'reportes' | 'correcciones';

const TOKEN_KEY = 'agropack_token';
const USER_KEY = 'agropack_user';

function normalizeRol(rol: string | undefined | null): string {
  if (!rol) return '';
  // Postgres/SQLAlchemy a veces devuelve ADMIN en vez de admin
  return String(rol).toLowerCase().trim();
}

function getAllowedTabs(role: string | undefined): TabId[] {
  const r = normalizeRol(role);
  if (!r) return ['dashboard'];

  switch (r) {
    case 'recepcion':
      return ['recepcion', 'dashboard', 'reportes'];
    case 'empacador':
      return ['empaque', 'dashboard', 'reportes'];
    case 'recepcion_empacador':
      return ['recepcion', 'empaque', 'dashboard', 'reportes'];
    case 'embarques':
      return ['embarques', 'dashboard', 'reportes'];
    case 'admin':
      return ['recepcion', 'empaque', 'embarques', 'usuarios', 'dashboard', 'reportes', 'correcciones'];
    case 'observador':
      return ['dashboard', 'reportes'];
    default:
      // Si el rol no se reconoce, dar acceso completo para no dejar la UI en blanco
      console.warn('Rol no reconocido, mostrando tabs de admin:', role);
      return ['recepcion', 'empaque', 'embarques', 'usuarios', 'dashboard', 'reportes', 'correcciones'];
  }
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  });
  const [activeTab, setActiveTab] = useState<TabId>('recepcion');
  const [loginError, setLoginError] = useState('');

  // Validar token guardado. Solo borrar sesión si la API responde 401 (token inválido).
  // No borrar por errores de red / cold start de Render (dejaría de nuevo el login).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getCurrentUser(token)
      .then((user) => {
        if (cancelled) return;
        setCurrentUser(user);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        const tabs = getAllowedTabs(user.rol);
        setActiveTab((prev) => (tabs.includes(prev) ? prev : tabs[0]));
      })
      .catch((err: any) => {
        if (cancelled) return;
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setToken('');
          setCurrentUser(null);
        } else {
          console.warn('No se pudo validar sesión (red/API). Se mantiene el token.', err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleLogin = async () => {
    setLoginError('');
    try {
      const data = await login(username, password);
      const accessToken = data?.access_token;
      if (!accessToken) {
        setLoginError(
          'La API no devolvió token. En Render → agropack-web → Environment pon VITE_API_URL=https://agropack-api.onrender.com y haz Manual Deploy (Clear build cache).'
        );
        return;
      }

      // Guardar token YA, antes de /me, para no perder la sesión
      localStorage.setItem(TOKEN_KEY, accessToken);
      setToken(accessToken);

      const user = await getCurrentUser(accessToken);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      setCurrentUser(user);
      setPassword('');

      const tabs = getAllowedTabs(user.rol);
      setActiveTab(tabs[0] || 'dashboard');
    } catch (err: any) {
      console.error(err);
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      const msg = err?.message || '';

      if (status === 401 || status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken('');
        setCurrentUser(null);
        setLoginError(typeof detail === 'string' ? detail : 'Usuario o contraseña incorrectos.');
      } else if (msg.includes('VITE_API_URL') || msg.includes('access_token') || msg.includes('JSON')) {
        setLoginError(msg);
      } else if (!localStorage.getItem(TOKEN_KEY)) {
        setLoginError(
          'No se pudo conectar con la API. Revisa VITE_API_URL=https://agropack-api.onrender.com en Render (agropack-web) y espera 30s si la API estaba dormida.'
        );
      } else {
        setLoginError('');
        setCurrentUser({
          id: 0,
          username: username || 'usuario',
          nombre_completo: username || 'usuario',
          rol: 'admin',
        });
        setActiveTab('recepcion');
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken('');
    setCurrentUser(null);
    setUsername('');
    setPassword('');
  };

  const { data: dashboardData, refetch: refetchDashboard } = useDashboard(token);
  const { data: clientes = [] } = useClientes(token);

  const inventarioCampo = dashboardData?.inventario_campo || [];
  const inventarioCarton = dashboardData?.inventario_final || [];
  const desverdizado = dashboardData?.desverdizado || [];

  const cargarDashboard = async () => {
    try {
      await refetchDashboard?.();
    } catch {
      /* ignore */
    }
  };
  const cargarClientes = async () => {};

  const allowedTabs = currentUser ? getAllowedTabs(currentUser.rol) : [];
  const visibleTabs = (
    ['recepcion', 'empaque', 'embarques', 'usuarios', 'dashboard', 'reportes', 'correcciones'] as TabId[]
  ).filter((tab) => allowedTabs.includes(tab));

  // Si la pestaña activa no está permitida, corregir
  useEffect(() => {
    if (token && visibleTabs.length > 0 && !visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0]);
    }
  }, [token, visibleTabs, activeTab]);

  const tabButtonStyle = (tab: TabId): CSSProperties => ({
    marginRight: '8px',
    marginBottom: '8px',
    padding: '10px 16px',
    background: activeTab === tab ? '#15803d' : '#f1f5f9',
    color: activeTab === tab ? 'white' : '#334155',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: activeTab === tab ? 700 : 400,
  });

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', maxWidth: '1400px', margin: '0 auto' }}>
      <h1>🌱 AgroPack Llano - Sistema de Inventario</h1>

      {!token ? (
        <div
          style={{
            maxWidth: '400px',
            margin: '0 auto',
            background: 'white',
            padding: '30px',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}
        >
          <h2>Iniciar Sesión</h2>
          <input
            type="text"
            placeholder="Usuario"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ width: '100%', padding: '12px', margin: '10px 0' }}
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            style={{ width: '100%', padding: '12px', margin: '10px 0' }}
          />
          {loginError && (
            <p style={{ color: '#dc2626', fontSize: '14px', margin: '8px 0' }}>{loginError}</p>
          )}
          <button
            onClick={handleLogin}
            style={{
              width: '100%',
              padding: '14px',
              background: '#15803d',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Iniciar Sesión
          </button>
        </div>
      ) : (
        <>
          <p style={{ marginBottom: '8px' }}>
            <strong>Usuario:</strong> {currentUser?.username || username}{' '}
            {currentUser?.rol ? `(${normalizeRol(currentUser.rol)})` : ''} |{' '}
            <button type="button" onClick={handleLogout}>
              Cerrar Sesión
            </button>
          </p>

          <div style={{ margin: '20px 0', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {visibleTabs.includes('recepcion') && (
              <button type="button" onClick={() => setActiveTab('recepcion')} style={tabButtonStyle('recepcion')}>
                Recepción
              </button>
            )}
            {visibleTabs.includes('empaque') && (
              <button type="button" onClick={() => setActiveTab('empaque')} style={tabButtonStyle('empaque')}>
                Empaque
              </button>
            )}
            {visibleTabs.includes('embarques') && (
              <button type="button" onClick={() => setActiveTab('embarques')} style={tabButtonStyle('embarques')}>
                Embarques
              </button>
            )}
            {visibleTabs.includes('usuarios') && (
              <button type="button" onClick={() => setActiveTab('usuarios')} style={tabButtonStyle('usuarios')}>
                Usuarios
              </button>
            )}
            {visibleTabs.includes('dashboard') && (
              <button type="button" onClick={() => setActiveTab('dashboard')} style={tabButtonStyle('dashboard')}>
                Inventarios
              </button>
            )}
            {visibleTabs.includes('reportes') && (
              <button type="button" onClick={() => setActiveTab('reportes')} style={tabButtonStyle('reportes')}>
                Reportes
              </button>
            )}
            {visibleTabs.includes('correcciones') && (
              <button
                type="button"
                onClick={() => setActiveTab('correcciones')}
                style={tabButtonStyle('correcciones')}
              >
                Correcciones
              </button>
            )}
          </div>

          {visibleTabs.length === 0 && (
            <p style={{ color: '#dc2626' }}>
              Sesión iniciada pero no hay pestañas para este rol ({String(currentUser?.rol)}). Cierra sesión e intenta de
              nuevo o contacta al administrador.
            </p>
          )}

          {activeTab === 'recepcion' && visibleTabs.includes('recepcion') && (
            <Recepcion token={token} onRecepcionRegistered={cargarDashboard} />
          )}

          {activeTab === 'empaque' && visibleTabs.includes('empaque') && (
            <Empaque
              token={token}
              inventarioCampo={inventarioCampo}
              inventarioFinal={inventarioCarton}
              onEmpaqueRegistered={cargarDashboard}
            />
          )}

          {activeTab === 'embarques' && visibleTabs.includes('embarques') && (
            <Embarques
              token={token}
              inventarioFinal={inventarioCarton}
              onEmbarqueRegistered={cargarDashboard}
              clientes={clientes}
              cargarClientes={cargarClientes}
            />
          )}

          {activeTab === 'dashboard' && visibleTabs.includes('dashboard') && (
            <Dashboard
              inventarioCampo={inventarioCampo}
              inventarioCarton={inventarioCarton}
              desverdizado={desverdizado}
            />
          )}

          {activeTab === 'usuarios' && visibleTabs.includes('usuarios') && <Usuarios token={token} />}

          {activeTab === 'reportes' && visibleTabs.includes('reportes') && <Reportes token={token} />}

          {activeTab === 'correcciones' && visibleTabs.includes('correcciones') && (
            <Correcciones token={token} onCorregido={cargarDashboard} />
          )}
        </>
      )}
    </div>
  );
}

export default App;
