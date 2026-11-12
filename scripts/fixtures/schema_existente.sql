CREATE TABLE users (
	id INTEGER NOT NULL, 
	username VARCHAR NOT NULL, 
	nombre_completo VARCHAR NOT NULL, 
	rol VARCHAR(19) NOT NULL, 
	hashed_password VARCHAR NOT NULL, 
	PRIMARY KEY (id)
);
CREATE UNIQUE INDEX ix_users_username ON users (username);
CREATE INDEX ix_users_id ON users (id);
CREATE TABLE inventario_campo (
	id INTEGER NOT NULL, 
	variedad VARCHAR(12) NOT NULL, 
	mercado VARCHAR(11) NOT NULL, 
	cantidad_disponible INTEGER, 
	fecha_actualizacion DATETIME, 
	PRIMARY KEY (id)
);
CREATE INDEX ix_inventario_campo_id ON inventario_campo (id);
CREATE TABLE inventario_final (
	id INTEGER NOT NULL, 
	producto VARCHAR(14) NOT NULL, 
	variedad VARCHAR(12), 
	tipo_cultivo VARCHAR(12), 
	mercado VARCHAR(11) NOT NULL, 
	cantidad_stock INTEGER, 
	fecha_actualizacion DATETIME, 
	atributos_extra JSON, 
	PRIMARY KEY (id)
);
CREATE INDEX ix_inventario_final_id ON inventario_final (id);
CREATE TABLE productos (
	id INTEGER NOT NULL, 
	nombre VARCHAR NOT NULL, 
	codigo VARCHAR NOT NULL, 
	descripcion VARCHAR, 
	activo INTEGER, 
	fecha_creacion DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (nombre), 
	UNIQUE (codigo)
);
CREATE INDEX ix_productos_id ON productos (id);
CREATE TABLE clientes (
	id INTEGER NOT NULL, 
	nombre VARCHAR NOT NULL, 
	empresa VARCHAR, 
	contacto VARCHAR, 
	email VARCHAR, 
	telefono VARCHAR, 
	notas VARCHAR, 
	activo INTEGER, 
	fecha_creacion DATETIME, 
	PRIMARY KEY (id)
);
CREATE INDEX ix_clientes_id ON clientes (id);
CREATE TABLE lote_melon_hectareas (
	id INTEGER NOT NULL, 
	area VARCHAR NOT NULL, 
	seccion INTEGER NOT NULL, 
	variedad VARCHAR NOT NULL, 
	lote VARCHAR NOT NULL, 
	hectareas FLOAT NOT NULL, 
	fecha_actualizacion DATETIME, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_lote_melon_area_seccion_variedad UNIQUE (area, seccion, variedad)
);
CREATE INDEX ix_lote_melon_hectareas_area ON lote_melon_hectareas (area);
CREATE INDEX ix_lote_melon_hectareas_id ON lote_melon_hectareas (id);
CREATE INDEX ix_lote_melon_hectareas_lote ON lote_melon_hectareas (lote);
CREATE TABLE recepcion_campo (
	id INTEGER NOT NULL, 
	fecha DATE, 
	hora DATETIME, 
	producto VARCHAR(14) NOT NULL, 
	variedad VARCHAR(12), 
	cantidad_cajas_campo INTEGER NOT NULL, 
	cantidad_cajas_carton INTEGER, 
	tipo_cultivo_carton VARCHAR(12), 
	mercado VARCHAR(11), 
	lote VARCHAR, 
	cantidad_bins INTEGER, 
	fecha_corte DATE, 
	usuario_id INTEGER, 
	PRIMARY KEY (id), 
	FOREIGN KEY(usuario_id) REFERENCES users (id)
);
CREATE INDEX ix_recepcion_campo_id ON recepcion_campo (id);
CREATE TABLE empaque (
	id INTEGER NOT NULL, 
	fecha DATE, 
	producto VARCHAR(14) NOT NULL, 
	variedad VARCHAR(12), 
	tipo_cultivo VARCHAR(12), 
	mercado VARCHAR(11) NOT NULL, 
	cantidad_cajas_campo_usadas INTEGER NOT NULL, 
	cantidad_cajas_carton_producidas INTEGER NOT NULL, 
	porcentaje_merma FLOAT, 
	notas_merma VARCHAR, 
	numero_empacador VARCHAR NOT NULL, 
	bins_desverdizado_usados INTEGER, 
	lote_desverdizado VARCHAR, 
	presentacion VARCHAR, 
	talla VARCHAR, 
	calidad VARCHAR, 
	cantidad_producida INTEGER, 
	detalle_corrida JSON, 
	usuario_id INTEGER, 
	PRIMARY KEY (id), 
	FOREIGN KEY(usuario_id) REFERENCES users (id)
);
CREATE INDEX ix_empaque_id ON empaque (id);
CREATE TABLE embarque (
	id INTEGER NOT NULL, 
	fecha_salida DATE, 
	hora_salida DATETIME, 
	cliente_id INTEGER NOT NULL, 
	notas VARCHAR, 
	estado VARCHAR, 
	usuario_id INTEGER, 
	PRIMARY KEY (id), 
	FOREIGN KEY(cliente_id) REFERENCES clientes (id), 
	FOREIGN KEY(usuario_id) REFERENCES users (id)
);
CREATE INDEX ix_embarque_id ON embarque (id);
CREATE TABLE parrilla (
	id INTEGER NOT NULL, 
	nombre VARCHAR NOT NULL, 
	estado VARCHAR, 
	variedad VARCHAR(12), 
	cantidad INTEGER, 
	usuario_id INTEGER, 
	PRIMARY KEY (id), 
	FOREIGN KEY(usuario_id) REFERENCES users (id)
);
CREATE INDEX ix_parrilla_id ON parrilla (id);
CREATE TABLE embarque_detalle (
	id INTEGER NOT NULL, 
	embarque_id INTEGER NOT NULL, 
	producto VARCHAR(14) NOT NULL, 
	variedad VARCHAR(12), 
	tipo_cultivo VARCHAR(12), 
	mercado VARCHAR(11) NOT NULL, 
	cantidad_cajas INTEGER NOT NULL, 
	presentacion VARCHAR, 
	talla VARCHAR, 
	calidad VARCHAR, 
	cajas_por_parrilla INTEGER, 
	PRIMARY KEY (id), 
	FOREIGN KEY(embarque_id) REFERENCES embarque (id)
);
CREATE INDEX ix_embarque_detalle_id ON embarque_detalle (id);
CREATE TABLE inventario_desverdizado (
	id INTEGER NOT NULL, 
	producto VARCHAR(14) NOT NULL, 
	cantidad_bins INTEGER NOT NULL, 
	lote VARCHAR NOT NULL, 
	fecha_recepcion DATE NOT NULL, 
	fecha_tentativa_salida DATE NOT NULL, 
	fecha_real_salida DATE, 
	estado VARCHAR, 
	numero_tanda INTEGER, 
	usuario_id INTEGER, 
	recepcion_id INTEGER, 
	PRIMARY KEY (id), 
	FOREIGN KEY(usuario_id) REFERENCES users (id), 
	FOREIGN KEY(recepcion_id) REFERENCES recepcion_campo (id)
);
CREATE INDEX ix_inventario_desverdizado_numero_tanda ON inventario_desverdizado (numero_tanda);
CREATE INDEX ix_inventario_desverdizado_id ON inventario_desverdizado (id);
