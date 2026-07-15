import { useState } from 'react';
import Embarques from './components/Embarques/Embarques';
import Dashboard from './components/Dashboard/Dashboard';
import Empaque from './components/Empaque/Empaque';
import Recepcion from './components/Recepcion/Recepcion';
import Usuarios from './components/Usuarios/Usuarios';

import { login, getCurrentUser } from './lib/api';
import { useDashboard } from './hooks/useDashboard';
import { useClientes } from './hooks/useClientes';
import type { User } from './types';

function App() {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'recepcion' | 'empaque' | 'embarques' | 'usuarios' | 'dashboard'>('recepcion');

  const handleLogin = async () => {
    try {
      const data = await login(username, password);
      const user = await getCurrentUser(data.access_token);
      setToken(data.access_token);
      setCurrentUser(user);

      // Set a sensible default tab based on role
      const userAllowedTabs = getAllowedTabs(user.rol);
      const firstTab = userAllowedTabs[0] as any;
      if (firstTab) {
        setActiveTab(firstTab);
      }

      alert('¡Sesión iniciada correctamente!');
    } catch (err) {
      alert('Usuario o contraseña incorrectos');
    }
  };

  // React Query hooks
  const { data: dashboardData } = useDashboard(token);
  const { data: clientes = [] } = useClientes(token);

  const inventarioCampo = dashboardData?.inventario_campo || [];
  const inventarioCarton = dashboardData?.inventario_final || [];
  const desverdizado = dashboardData?.desverdizado || [];

  // These are now mostly handled by React Query invalidations
  const cargarDashboard = async () => {};
  const cargarClientes = async () => {};

  // Role-based tab permissions
  const getAllowedTabs = (role: string | undefined): string[] => {
    if (!role) return ['dashboard'];

    switch (role) {
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
        return ['dashboard'];
    }
  };

  const allowedTabs = currentUser ? getAllowedTabs(currentUser.rol) : [];
  const visibleTabs = ['recepcion', 'empaque', 'embarques', 'usuarios', 'dashboard'].filter(tab =>
    allowedTabs.includes(tab)
  );

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', maxWidth: '1400px', margin: '0 auto' }}>
      <h1>🌱 AgroPack Llano - Sistema de Inventario</h1>

      {!token ? (
        <div style={{ maxWidth: '400px', margin: '0 auto', background: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <h2>Iniciar Sesión</h2>
          <input type="text" placeholder="Usuario" value={username} onChange={(e) => setUsername(e.target.value)} style={{width: '100%', padding: '12px', margin: '10px 0'}} />
          <input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} style={{width: '100%', padding: '12px', margin: '10px 0'}} />
          <button onClick={handleLogin} style={{width: '100%', padding: '14px', background: '#15803d', color: 'white', border: 'none', borderRadius: '6px'}}>Iniciar Sesión</button>
        </div>
      ) : (
        <>
          <p><strong>Usuario:</strong> {username} | <button onClick={() => window.location.reload()}>Cerrar Sesión</button></p>

          <div style={{ margin: '25px 0' }}>
            {visibleTabs.includes('recepcion') && (
              <button onClick={() => setActiveTab('recepcion')} style={{marginRight: '8px', padding: '10px 16px'}}>Recepción</button>
            )}
            {visibleTabs.includes('empaque') && (
              <button onClick={() => setActiveTab('empaque')} style={{marginRight: '8px', padding: '10px 16px'}}>Empaque</button>
            )}
            {visibleTabs.includes('embarques') && (
              <button onClick={() => setActiveTab('embarques')} style={{marginRight: '8px', padding: '10px 16px'}}>Embarques</button>
            )}
            {visibleTabs.includes('usuarios') && (
              <button onClick={() => setActiveTab('usuarios')} style={{marginRight: '8px', padding: '10px 16px'}}>Usuarios</button>
            )}
            {visibleTabs.includes('dashboard') && (
              <button onClick={() => setActiveTab('dashboard')}>Dashboard</button>
            )}
          </div>

          {/* Recepción */}
          {activeTab === 'recepcion' && visibleTabs.includes('recepcion') && (
            <Recepcion
              token={token}
              onRecepcionRegistered={cargarDashboard}
            />
          )}

          {/* Empaque */}
          {activeTab === 'empaque' && visibleTabs.includes('empaque') && (
            <Empaque
              token={token}
              inventarioCampo={inventarioCampo}
              onEmpaqueRegistered={cargarDashboard}
            />
          )}

          {/* Embarques */}
          {activeTab === 'embarques' && visibleTabs.includes('embarques') && (
            <Embarques
              token={token}
              inventarioFinal={inventarioCarton}
              onEmbarqueRegistered={cargarDashboard}
              clientes={clientes}
              cargarClientes={cargarClientes}
            />
          )}

          {/* Dashboard */}
          {activeTab === 'dashboard' && visibleTabs.includes('dashboard') && (
            <Dashboard
              inventarioCampo={inventarioCampo}
              inventarioCarton={inventarioCarton}
              desverdizado={desverdizado}
            />
          )}

          {/* Usuarios (Gestión de usuarios) */}
          {activeTab === 'usuarios' && visibleTabs.includes('usuarios') && (
            <Usuarios token={token} />
          )}
        </>
      )}
    </div>
  );
}

export default App;