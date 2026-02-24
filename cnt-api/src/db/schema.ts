import { pgTable, serial, varchar, timestamp, boolean, integer, decimal, text, uuid } from 'drizzle-orm/pg-core';

// Tenants (multi-tenant)
export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
  razonSocial: varchar('razon_social', { length: 255 }),
  nit: varchar('nit', { length: 20 }),
  activo: boolean('activo').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Usuarios
export const usuarios = pgTable('usuarios', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
  rol: varchar('rol', { length: 50 }).default('usuario'), // admin, contador, usuario
  activo: boolean('activo').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// API Keys
export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  usuarioId: integer('usuario_id').references(() => usuarios.id).notNull(),
  key: varchar('key', { length: 255 }).notNull().unique(),
  nombre: varchar('nombre', { length: 255 }),
  expiresAt: timestamp('expires_at'),
  activo: boolean('activo').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// Clientes
export const clientes = pgTable('clientes', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
  nit: varchar('nit', { length: 20 }),
  direccion: varchar('direccion', { length: 500 }),
  telefono: varchar('telefono', { length: 50 }),
  email: varchar('email', { length: 255 }),
  activo: boolean('activo').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Proveedores
export const proveedores = pgTable('proveedores', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
  nit: varchar('nit', { length: 20 }),
  direccion: varchar('direccion', { length: 500 }),
  telefono: varchar('telefono', { length: 50 }),
  email: varchar('email', { length: 255 }),
  activo: boolean('activo').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Productos/Servicios
export const productos = pgTable('productos', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  codigo: varchar('codigo', { length: 50 }),
  nombre: varchar('nombre', { length: 255 }).notNull(),
  descripcion: text('descripcion'),
  tipo: varchar('tipo', { length: 20 }).default('producto'), // producto, servicio
  precioVenta: decimal('precio_venta', { precision: 18, scale: 2 }),
  precioCosto: decimal('precio_costo', { precision: 18, scale: 2 }),
  stock: integer('stock').default(0),
  unidad: varchar('unidad', { length: 20 }),
  activo: boolean('activo').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Comprobantes (facturas, notas, etc.)
export const comprobantes = pgTable('comprobantes', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  tipo: varchar('tipo', { length: 20 }).notNull(), // factura, nota_credito, nota_debito, boleta
  numero: varchar('numero', { length: 50 }).notNull(),
  serie: varchar('serie', { length: 20 }),
  clienteId: integer('cliente_id').references(() => clientes.id),
  proveedorId: integer('proveedor_id').references(() => proveedores.id),
  fecha: timestamp('fecha').defaultNow(),
  total: decimal('total', { precision: 18, scale: 2 }).default('0'),
  estado: varchar('estado', { length: 20 }).default('vigente'), // vigente, anulado
  jsonData: text('json_data'), // datos adicionales en JSON
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Plan de Cuentas - definido sin referencia circular para evitar TS error
export const cuentas = pgTable('cuentas', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull(), //.references(() => tenants.id).notNull(),
  codigo: varchar('codigo', { length: 20 }).notNull(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
  tipo: varchar('tipo', { length: 20 }).notNull(), // activo, pasivo, patrimonio, ingreso, gasto
  naturaleza: varchar('naturaleza', { length: 20 }).notNull(), // deudora, acreedora
  padreId: integer('padre_id'), // .references(() => cuentas.id),
  nivel: integer('nivel').default(1),
  auxiliar: boolean('auxiliar').default(false),
  activo: boolean('activo').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Asientos Contables
export const asientos = pgTable('asientos', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  numero: varchar('numero', { length: 50 }).notNull(),
  fecha: timestamp('fecha').defaultNow(),
  glosa: varchar('glosa', { length: 500 }),
  comprobanteId: integer('comprobante_id').references(() => comprobantes.id),
  estado: varchar('estado', { length: 20 }).default('confirmado'), // borrador, confirmado, anulado
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Lineas de Asiento
export const asientoLineas = pgTable('asiento_lineas', {
  id: serial('id').primaryKey(),
  asientoId: integer('asiento_id').references(() => asientos.id).notNull(),
  cuentaId: integer('cuenta_id').references(() => cuentas.id).notNull(),
  debe: decimal('debe', { precision: 18, scale: 2 }).default('0'),
  haber: decimal('haber', { precision: 18, scale: 2 }).default('0'),
});
