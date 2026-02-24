-- Inicializar base de datos cnt-api
-- Ejecutar: psql -U postgres -d cnt -f init.sql

-- Tablas
CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    razon_social VARCHAR(255),
    nit VARCHAR(20),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    rol VARCHAR(50) DEFAULT 'usuario',
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
    usuario_id INTEGER REFERENCES usuarios(id) NOT NULL,
    key VARCHAR(255) NOT NULL UNIQUE,
    nombre VARCHAR(255),
    expires_at TIMESTAMP,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    nit VARCHAR(20),
    direccion VARCHAR(500),
    telefono VARCHAR(50),
    email VARCHAR(255),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proveedores (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    nit VARCHAR(20),
    direccion VARCHAR(500),
    telefono VARCHAR(50),
    email VARCHAR(255),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS productos (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
    codigo VARCHAR(50),
    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT,
    tipo VARCHAR(20) DEFAULT 'producto',
    precio_venta DECIMAL(18,2),
    precio_costo DECIMAL(18,2),
    stock INTEGER DEFAULT 0,
    unidad VARCHAR(20),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comprobantes (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
    tipo VARCHAR(20) NOT NULL,
    numero VARCHAR(50) NOT NULL,
    serie VARCHAR(20),
    cliente_id INTEGER REFERENCES clientes(id),
    proveedor_id INTEGER REFERENCES proveedores(id),
    fecha TIMESTAMP DEFAULT NOW(),
    total DECIMAL(18,2) DEFAULT 0,
    estado VARCHAR(20) DEFAULT 'vigente',
    json_data TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cuentas (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    codigo VARCHAR(20) NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    tipo VARCHAR(20) NOT NULL,
    naturaleza VARCHAR(20) NOT NULL,
    padre_id INTEGER REFERENCES cuentas(id),
    nivel INTEGER DEFAULT 1,
    auxiliar BOOLEAN DEFAULT false,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asientos (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    numero VARCHAR(50) NOT NULL,
    fecha TIMESTAMP DEFAULT NOW(),
    glosa VARCHAR(500),
    comprobante_id INTEGER REFERENCES comprobantes(id),
    estado VARCHAR(20) DEFAULT 'confirmado',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asiento_lineas (
    id SERIAL PRIMARY KEY,
    asiento_id INTEGER REFERENCES asientos(id) NOT NULL,
    cuenta_id INTEGER REFERENCES cuentas(id) NOT NULL,
    debe DECIMAL(18,2) DEFAULT 0,
    haber DECIMAL(18,2) DEFAULT 0
);

-- Datos de prueba
-- Tenant de prueba
INSERT INTO tenants (nombre, razon_social, nit) VALUES
    ('Empresa Demo', 'Empresa Demo SAS', '12345678901')
ON CONFLICT DO NOTHING;

-- Usuario de prueba (password: demo123)
-- Password hash de 'demo123' con bcrypt
INSERT INTO usuarios (tenant_id, email, password_hash, nombre, rol, activo)
VALUES (1, 'admin@demo.com', '$2b$10$rBV2JzS9QKQ6WzQXvQXvXeYXQXQXQXQXQXQXQXQXQXQXQXQXQXQ', 'Administrador', 'admin', true)
ON CONFLICT DO NOTHING;
