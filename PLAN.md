# PLAN DE IMPLEMENTACIÓN - AgroPack Llano
## Piloto Interno Controlado con Usuarios Reales

**Fecha de creación:** Mayo 2026  
**Versión:** 1.0  
**Estado:** En ejecución

---

## 1. Objetivo Principal

Llegar a un **Piloto Interno Controlado** donde entre 5 y 8 usuarios internos de la empresa utilicen la herramienta con datos reales de forma estable y productiva.

**Meta:** Tener el piloto activo a más tardar en **Semana 7**.

---

## 2. Alcance del Piloto

### Incluido:
- Productos actuales (**solo Uva**)
- Funcionalidades existentes:
  - Recepción de Campo / Caja de Cartón
  - Empaque
  - Embarques
  - Dashboard básico
- Gestión básica de usuarios (crear usuarios con roles)
- Acceso desde la red interna de la empresa

### Excluido (por ahora):
- Nuevos productos (Chile / Jalapeño, etc.)
- Nuevas secciones del Dashboard (Calidades, reportes avanzados, etc.)
- Versión móvil / responsive avanzada
- Acceso desde internet público (solo red interna por ahora)

---

## 3. Decisiones Clave Tomadas

| Decisión | Estado | Justificación |
|----------|--------|---------------|
| Migrar de SQLite a **PostgreSQL** | Aprobada | Mejor robustez, concurrencia y backups para uso real |
| Postergar desarrollo de nuevos productos y dashboard | Aprobada | Enfocarnos primero en estabilizar y desplegar |
| Tiempo no es crítico | Confirmado | Permite hacer las cosas con calidad |
| Usuarios: 5-10 empleados internos | Confirmado | Bajo riesgo comparado con usuarios externos |
| Servidor físico con red compartida | Disponible | Requiere configuración cuidadosa de seguridad y backups |

---

## 4. Timeline General (7 Semanas)

| Semana | Fase Principal | Enfoque | Entregable Principal |
|--------|----------------|---------|----------------------|
| **0** | Preparación | Alineación + Preparación del técnico | Entorno de Postgres listo + PLAN actualizado |
| **1-2** | Base de Datos | Migración a PostgreSQL + Gestión de Usuarios | Datos migrados + forma de crear usuarios |
| **3-4** | Infraestructura | Despliegue en servidor físico + Backups | Aplicación estable en el servidor |
| **5-6** | UX y Estabilidad | React Query + Carga + Errores + Logout | Mejor experiencia de uso |
| **7** | Piloto | Pruebas + Puesta en marcha | 5-8 usuarios usando la herramienta |

---

## 5. Detalle por Semana

### Semana 0 – Preparación (Semana Actual)

**Objetivo:** Dejar todo listo para arrancar fuerte.

**Tareas Desarrollo:**
- Crear y mantener este `PLAN.md`
- Preparar el backend para soportar PostgreSQL de forma limpia (mantener compatibilidad temporal con SQLite)
- Mejorar defensivamente el script de migración (sin requerir SECRET_KEY ni driver Postgres en dry-run)
- Revisar y endurecer seguridad de endpoints sensibles (registro de usuarios + gestión de clientes)
- Establecer patrón reutilizable de autorización por roles

**Tareas Infraestructura (Técnico):**
- Instalar PostgreSQL en un entorno de pruebas en el servidor
- Crear usuario y base de datos de prueba
- Documentar los comandos básicos que usará
- Compartir acceso o guía con el equipo de desarrollo

**Entregables de la semana:**
- PostgreSQL instalado y accesible (entorno de pruebas)
- PLAN.md actualizado y compartido
- Script de migración probado en modo real (72 registros migrados exitosamente en prueba)
- Mejoras de seguridad básicas implementadas (register + clientes) + patrón de roles reutilizable

---

### Semana 1 – Migración a PostgreSQL (Parte 1)

**Tareas Desarrollo:**
- Actualizar `database.py` y configuración para soportar PostgreSQL
- Crear script de migración de datos (SQLite → PostgreSQL)
- Probar la migración en entorno local
- Actualizar `docker-compose.yml` si aplica
- Mejorar gestión de usuarios (endpoints para listar y administrar usuarios con roles) — **Avanzado**

**Tareas Infraestructura (Técnico):**
- Configurar PostgreSQL en el servidor (producción de pruebas)
- Configurar backups básicos de la base de datos
- Definir estrategia de respaldos (diarios + retención)

**Entregable:**
- Migración de datos funcionando localmente

---

### Semana 2 – Migración a PostgreSQL + Gestión de Usuarios

**Tareas Desarrollo:**
- Completar y probar script de migración con datos reales
- Mejorar la gestión de usuarios:
  - Proteger el endpoint `/register`
  - Crear un endpoint o pantalla simple para listar y crear usuarios (con roles)
- Actualizar roles si es necesario

**Tareas Infraestructura:**
- Ejecutar migración en el servidor de pruebas
- Validar que la aplicación funcione contra PostgreSQL

**Entregable:**
- Base de datos PostgreSQL en uso + forma básica de crear usuarios

---

### Semana 3-4 – Despliegue en Servidor Físico

**Responsable principal:** Técnico (con apoyo de desarrollo)

**Tareas clave:**
- Desplegar el backend (recomendado: Docker o systemd)
- Configurar frontend (build + servir estático o con Nginx)
- Configurar reverse proxy (Nginx recomendado)
- Configurar HTTPS (incluso en red interna es altamente recomendable)
- Configurar reinicio automático de servicios
- Documentar cómo levantar y actualizar la aplicación

**Entregable:**
- Aplicación accesible desde la red interna de forma estable

---

### Semana 5-6 – Robustecimiento de UX

**Tareas Desarrollo:**
- Terminar integración de React Query en todos los flujos importantes
- Agregar estados de carga consistentes en formularios
- Mejorar manejo de errores (reemplazar muchos `alert()`)
- Implementar logout funcional
- Revisar y mejorar mensajes de error al usuario

**Entregable:**
- Aplicación con mejor experiencia de uso y retroalimentación

---

### Semana 7 – Pruebas y Puesta en Marcha del Piloto

**Actividades:**
- Pruebas internas exhaustivas (flujo completo)
- Crear los primeros 5-8 usuarios reales con sus roles
- Sesión de capacitación corta a los usuarios
- Iniciar piloto con un grupo reducido (3-5 personas)
- Canal de feedback (WhatsApp, Excel o formulario simple)

**Entregable:**
- Piloto activo con usuarios reales usando la herramienta

---

## 6. Responsabilidades

| Rol | Horas/semana | Responsabilidades Principales |
|-----|--------------|-------------------------------|
| **Desarrollo** (Usuario + Grok) | 20h | Código, migración de datos, UX, lógica de usuarios, React Query |
| **Técnico** | 24h | PostgreSQL, servidor, despliegue, backups, red, seguridad básica |
| **Usuario (Líder)** | - | Toma de decisiones, coordinación, priorización |

---

## 7. Riesgos Identificados

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| El técnico se atrasa con Postgres/Servidor | Media | Alto | Empezar esta misma semana con Postgres |
| Problemas durante la migración de datos | Media | Alto | Hacer varias pruebas locales antes de migrar en servidor |
| La aplicación se vuelve inestable después del despliegue | Media | Medio | Mantener SQLite como respaldo temporal si es necesario |
| Usuarios se frustran por mala UX | Alta | Medio | Priorizar estados de carga y mensajes claros en Semana 5-6 |
| Aparecen bugs importantes durante el piloto | Media | Medio | Empezar con piloto reducido (3 usuarios) |

---

## 8. Criterios para Iniciar el Piloto

Antes de dar acceso a los primeros usuarios reales, se debe cumplir:

- [ ] Aplicación corriendo estable en el servidor físico
- [ ] Base de datos en PostgreSQL con backups funcionando
- [ ] Al menos 5 usuarios creados correctamente con roles
- [ ] Logout funcional
- [ ] Principales flujos (Recepción → Empaque → Embarque) probados end-to-end
- [ ] Estados de carga presentes en los formularios principales
- [ ] Algún canal de reporte de problemas definido

---

## 9. Próximos Pasos Inmediatos (Semana 0) - ACTUALIZADO

**Estado:** En progreso

**Acciones ya iniciadas:**
- [x] PLAN.md creado
- [x] `backend/app/core/database.py` refactorizado para soportar PostgreSQL de forma limpia
- [x] **Script de migración mejorado** (`backend/scripts/migrate_sqlite_to_postgres.py`):
    - Usa el orden correcto de tablas según foreign keys
    - Soporta `--dry-run`
    - Incluye opción `--reset-seq` para resetear secuencias de PostgreSQL
    - Mejor logging y manejo de errores
    - **Más defensivo**:
        - Ya no requiere `SECRET_KEY` para ejecutarse
        - `--dry-run` funciona aunque no esté instalado el driver de PostgreSQL (`psycopg2`)
    - **Migración real completada** (May 2026):
        - Se migraron exitosamente los 72 registros reales desde SQLite a PostgreSQL.
        - Verificación de integridad de datos completada.

- [x] **Limpieza de código post-migración**:
    - Se consolidaron los roles: `gerente_empaque` y `director_comercial` fueron eliminados. Ahora existe un solo rol privilegiado llamado `admin`.
    - Se limpió el enum `Rol` en `backend/app/models/enums.py` (se removieron los roles temporales usados durante la migración).
    - Se eliminó el script auxiliar `fix_roles_post_migration.py` (ya no era necesario).

- [x] **Documentación para pruebas contra PostgreSQL**:
    - Se creó el archivo `INSTRUCCIONES_POSTGRES.md` con pasos claros para configurar y probar la aplicación contra una base de datos PostgreSQL (local o en servidor).

- [x] **Mejoras de seguridad y autorización**:
    - Endpoint `/api/auth/register` protegido (requiere rol `admin` una vez que existe al menos un usuario + modo bootstrap para el primer usuario).
    - Creación, actualización y eliminación de clientes (`/api/clientes`) ahora requieren rol privilegiado.
    - Se crearon helpers reutilizables en `app/core/security.py` (`require_roles`, `get_current_user`, `get_user_from_token`) para proteger fácilmente otros endpoints en el futuro.

- [x] **Mejora en Gestión de Usuarios**:
    - Nuevo endpoint `GET /api/auth/users` → lista todos los usuarios (filtrable por rol). Solo accesible para roles privilegiados.
    - Nuevo endpoint `GET /api/auth/me` → devuelve info del usuario autenticado actual.
    - Nuevo endpoint `GET /api/auth/roles` → devuelve la lista de roles disponibles (útil para formularios).
    - La creación de usuarios sigue haciéndose a través del endpoint protegido `/register`.
    - Endpoints PATCH y DELETE para usuarios agregados.
    - Esto permite ahora una gestión básica de usuarios sin depender exclusivamente de curl.

- [x] **Endpoints operativos protegidos**:
    - Recepción, Empaque y Embarques ahora requieren rol (al menos recepcion_empacador o superior para crear).
    - Embarques requiere rol gerente o superior.

**Próximas acciones recomendadas esta semana:**
1. ~~Confirmar decisión final de migrar a Postgres con el técnico~~ → **COMPLETADO**
2. **Realizado:** Técnico instaló PostgreSQL 14 (en lugar de 18.4-1) en servidor físico Windows usando Windows Installer + Stack Builder (sin componentes adicionales). Instrucciones actualizadas para reflejar la versión real.
3. ~~Probar el script de migración real~~ → **COMPLETADO** (se migraron los 72 registros reales exitosamente en entorno de desarrollo)
4. ~~Limpieza de código del enum y consolidación de roles~~ → **COMPLETADO**
5. **Pendiente (cuando se migre en servidor):** Verificar / limpiar datos en la base Postgres del técnico si aparecen roles antiguos (gerente_empaque / director_comercial) → convertirlos a `admin`
6. ~~Preparar y documentar instrucciones claras para probar la aplicación contra PostgreSQL~~ → **COMPLETADO y AMPLIADO** (documentación actualizada a PostgreSQL 14 que se instaló realmente)
7. Agregar `psycopg2-binary` a requirements.txt → **COMPLETADO**
8. Actualizar este PLAN.md con el estado real cada viernes

**Próxima reunión recomendada:** Final de Semana 0 para revisar avances del técnico y alinear Semana 1.

---

**Documento vivo.** Se actualizará cada semana con el estado real del proyecto.

---

¿Quieres que ahora empecemos a ejecutar las primeras tareas técnicas de la **Semana 0** (preparación del backend para Postgres)? O prefieres que primero revisemos algo más del plan?