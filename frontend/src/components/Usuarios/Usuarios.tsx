import { useState, useEffect } from 'react';
import { getUsers, getRoles, registerUser, getCurrentUser, updateUser, deleteUser } from '../../lib/api';
import type { User } from '../../types';

interface UsuariosProps {
  token: string;
}

export default function Usuarios({ token }: UsuariosProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state
  const [newUsername, setNewUsername] = useState('');
  const [newNombre, setNewNombre] = useState('');
  const [newRol, setNewRol] = useState('recepcion_empacador');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);

  // Role editing state
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editingRole, setEditingRole] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [usersData, rolesData, me] = await Promise.all([
        getUsers(token),
        getRoles(token),
        getCurrentUser(token),
      ]);
      setUsers(usersData);
      setRoles(rolesData);
      setCurrentUser(me);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error cargando datos de usuarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  const handleCreateUser = async () => {
    if (!newUsername || !newNombre || !newPassword) {
      setError('Completa todos los campos');
      return;
    }

    setCreating(true);
    setError('');

    try {
      await registerUser(token, {
        username: newUsername,
        nombre_completo: newNombre,
        rol: newRol as any,
        password: newPassword,
      });

      // Reset form
      setNewUsername('');
      setNewNombre('');
      setNewPassword('');
      setNewRol('recepcion_empacador');

      // Refresh list
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al crear usuario');
    } finally {
      setCreating(false);
    }
  };

  const startEditingRole = (user: User) => {
    setEditingUserId(user.id);
    setEditingRole(user.rol);
    setError('');
  };

  const cancelEditingRole = () => {
    setEditingUserId(null);
    setEditingRole('');
  };

  const saveRoleChange = async (userId: number) => {
    if (!editingRole) return;

    try {
      await updateUser(token, userId, { rol: editingRole as any });
      setEditingUserId(null);
      setEditingRole('');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al cambiar rol');
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (!confirm(`¿Eliminar al usuario ${user.username}?`)) return;

    try {
      await deleteUser(token, user.id);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al eliminar usuario');
    }
  };

  if (loading) {
    return <div style={{ padding: 20 }}>Cargando usuarios...</div>;
  }

  return (
    <div style={{ background: 'white', padding: '25px', borderRadius: '10px' }}>
      <h2>👥 Gestión de Usuarios</h2>

      {currentUser && (
        <p style={{ color: '#166534', marginBottom: 20 }}>
          Sesión actual: <strong>{currentUser.nombre_completo}</strong> ({currentUser.rol})
        </p>
      )}

      {error && (
        <div style={{ color: 'red', marginBottom: 15, padding: 10, background: '#fee2e2', borderRadius: 6 }}>
          {error}
        </div>
      )}

      {/* Formulario de nuevo usuario */}
      <div style={{ marginBottom: 30, padding: 20, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
        <h3 style={{ marginTop: 0 }}>Crear nuevo usuario</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Usuario (username)"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            style={{ padding: 10 }}
          />
          <input
            type="text"
            placeholder="Nombre completo"
            value={newNombre}
            onChange={(e) => setNewNombre(e.target.value)}
            style={{ padding: 10 }}
          />
          <select
            value={newRol}
            onChange={(e) => setNewRol(e.target.value)}
            style={{ padding: 10 }}
          >
            {roles.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <input
            type="password"
            placeholder="Contraseña"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ padding: 10 }}
          />
        </div>
        <button
          onClick={handleCreateUser}
          disabled={creating}
          style={{
            padding: '10px 20px',
            background: creating ? '#64748b' : '#166534',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: creating ? 'not-allowed' : 'pointer',
          }}
        >
          {creating ? 'Creando...' : 'Crear Usuario'}
        </button>
      </div>

      {/* Lista de usuarios */}
      <h3>Usuarios registrados ({users.length})</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            <th style={{ padding: 10, textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>ID</th>
            <th style={{ padding: 10, textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Usuario</th>
            <th style={{ padding: 10, textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Nombre</th>
            <th style={{ padding: 10, textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Rol</th>
            <th style={{ padding: 10, textAlign: 'center', borderBottom: '1px solid #e2e8f0' }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
                No hay usuarios registrados.
              </td>
            </tr>
          ) : (
            users.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: 10 }}>{u.id}</td>
                <td style={{ padding: 10 }}><strong>{u.username}</strong></td>
                <td style={{ padding: 10 }}>{u.nombre_completo}</td>
                <td style={{ padding: 10 }}>
                  <span style={{
                    background: u.rol.includes('director') || u.rol.includes('gerente') ? '#dcfce7' : '#e0f2fe',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 13,
                  }}>
                    {u.rol}
                  </span>
                </td>
                <td style={{ padding: 10, textAlign: 'center' }}>
                  {editingUserId === u.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
                      <select
                        value={editingRole}
                        onChange={(e) => setEditingRole(e.target.value)}
                        style={{ padding: '4px 6px', fontSize: 12 }}
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => saveRoleChange(u.id)}
                        style={{ padding: '4px 8px', fontSize: 11, background: '#166534', color: 'white', border: 'none', borderRadius: 4 }}
                      >
                        Guardar
                      </button>
                      <button
                        onClick={cancelEditingRole}
                        style={{ padding: '4px 8px', fontSize: 11 }}
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => startEditingRole(u)}
                        style={{ marginRight: 6, padding: '4px 10px', fontSize: 12 }}
                      >
                        Cambiar rol
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u)}
                        style={{ padding: '4px 10px', fontSize: 12, background: '#dc2626', color: 'white', border: 'none', borderRadius: 4 }}
                      >
                        Eliminar
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <button
        onClick={loadData}
        style={{ marginTop: 15, padding: '8px 16px', background: '#64748b', color: 'white', border: 'none', borderRadius: 6 }}
      >
        Actualizar lista
      </button>
    </div>
  );
}
