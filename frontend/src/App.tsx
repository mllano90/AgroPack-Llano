import { useState, useEffect, type CSSProperties } from 'react';
import Embarques from './components/Embarques/Embarques';
import Dashboard from './components/Dashboard/Dashboard';
import Empaque from './components/Empaque/Empaque';
import Recepcion from './components/Recepcion/Recepcion';
import Usuarios from './components/Usuarios/Usuarios';

import { login, getCurrentUser } from './lib/api';
import { useDashboard } from './hooks/useDashboard';
import { useClientes } from './hooks/useClientes';
import type { User } from './types';

type TabId = 'recepcion' | 'empaque' | 'embarques' | 'usuarios' | 'dashboard';

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
      return ['recepcion', 'dashboard'];
    case 'empacador':
      return ['empaque', 'dashboard'];
    case 'recepcion_empacador':
      return ['recepcion', 'empaque', 'dashboard'];
    case 'embarques':
      return ['embarques', 'dashboard'];
    case 'admin':
      return ['recepcion', 'empaque', 'embarques', 'usuarios', 'dashboard'];
    case 'observador':
      return ['dashboard'];
    default:
      // Si el rol no se reconoce, dar acceso completo para no dejar la UI en blanco
      console.warn('Rol no reconocido, mostrando tabs de admin:', role);
      return ['recepcion', 'empaque', 'embarques', 'usuarios', 'dashboard'];
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

  // Restaurar sesión / validar token al cargar
  useEffect(() => {
    if (!token) return;
    getCurrentUser(token)
      .then((user) => {
        setCurrentUser(user);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        const tabs = getAllowedTabs(user.rol);
        setActiveTab((prev) => (tabs.includes(prev) ? prev : tabs[0]));
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken('');
        setCurrentUser(null);
      });
  }, [token]);

  const handleLogin = async () => {
    setLoginError('');
    try {
      const data = await login(username, password);
      const user = await getCurrentUser(data.access_token);

      localStorage.setItem(TOKEN_KEY, data.access_token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));

      setToken(data.access_token);
      setCurrentUser(user);
      setPassword('');

      const tabs = getAllowedTabs(user.rol);
      setActiveTab(tabs[0] || 'dashboard');
    } catch (err) {
      console.error(err);
      setLoginError('Usuario o contraseña incorrectos, o no se pudo conectar con la API.');
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

  const { data: dashboardData } = useDashboard(token);
  const { data: clientes = [] } = useClientes(token);

  const inventarioCampo = dashboardData?.inventario_campo || [];
  const inventarioCarton = dashboardData?.inventario_final || [];
  const desverdizado = dashboardData?.desverdizado || [];

  const cargarDashboard = async () => {};
  const cargarClientes = async () => {};

  const allowedTabs = currentUser ? getAllowedTabs(currentUser.rol) : [];
  const visibleTabs = (['recepcion', 'empaque', 'embarques', 'usuarios', 'dashboard'] as TabId[]).filter(
    (tab) => allowedTabs.includes(tab)
  );

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
                Dashboard
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
            <Empaque token={token} inventarioCampo={inventarioCampo} onEmpaqueRegistered={cargarDashboard} />
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
        </>
      )}
    </div>
  );
}

export default App;
