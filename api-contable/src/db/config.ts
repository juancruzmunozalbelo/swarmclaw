import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pgTable, uuid, varchar, text, timestamp, boolean, integer, decimal, jsonb, serial } from 'drizzle-orm/pg-core';

// Connection singleton
let dbInstance: ReturnType<typeof drizzle> | null = null;

export function getDb(tenantSchema?: string) {
  const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/contable';

  // For multitenant: append schema search path
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
  });

  if (tenantSchema) {
    // Set search path for tenant schema
    client.unsafe(`
      SET search_path TO ${tenantSchema}, public;
    `);
  }

  const db = drizzle(client);

  if (!tenantSchema) {
    dbInstance = db;
  }

  return db;
}

// ============================================
// SCHEMA: tenants (public, single instance)
// ============================================

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  schemaName: varchar('schema_name', { length: 63 }).notNull().unique(), // PostgreSQL schema name
  plan: varchar('plan', { length: 20 }).notNull().default('free'),
  apiKey: text('api_key').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  role: varchar('role', { length: 20 }).notNull().default('user'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// SCHEMA: tenant-specific (per tenant schema)
// ============================================

export const clientes = pgTable('clientes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  razonSocial: varchar('razon_social', { length: 255 }).notNull(),
  cuit: varchar('cuit', { length: 11 }).notNull(),
  direccion: varchar('direccion', { length: 500 }),
  telefono: varchar('telefono', { length: 50 }),
  email: varchar('email', { length: 255 }),
  condicionIva: varchar('condicion_iva', { length: 50 }).notNull(), // RI, RNI, EX, CF
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const proveedores = pgTable('proveedores', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  razonSocial: varchar('razon_social', { length: 255 }).notNull(),
  cuit: varchar('cuit', { length: 11 }).notNull(),
  direccion: varchar('direccion', { length: 500 }),
  telefono: varchar('telefono', { length: 50 }),
  email: varchar('email', { length: 255 }),
  condicionIva: varchar('condicion_iva', { length: 50 }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const productos = pgTable('productos', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  codigo: varchar('codigo', { length: 50 }).notNull(),
  descripcion: varchar('descripcion', { length: 500 }).notNull(),
  precioUnitario: decimal('precio_unitario', { precision: 12, scale: 2 }).notNull(),
  unidadMedida: varchar('unidad_medida', { length: 20 }).notNull(), // UN, KG, LT, etc
  alicuotaIva: decimal('alicuota_iva', { precision: 5, scale: 2 }).notNull(), // 21, 10.5, 0, etc
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const monedas = pgTable('monedas', {
  id: serial('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  codigo: varchar('codigo', { length: 3 }).notNull(), // ISO 4217
  nombre: varchar('nombre', { length: 100 }).notNull(),
  simbolo: varchar('simbolo', { length: 10 }).notNull(),
  tipoCambio: decimal('tipo_cambio', { precision: 10, scale: 4 }).notNull().default('1'),
  isBase: boolean('is_base').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const comprobantes = pgTable('comprobantes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  tipo: varchar('tipo', { length: 2 }).notNull(), // 01=FV, 02=FC, 03=NC, 04=ND, 99=Remito
  serie: varchar('serie', { length: 3 }).notNull(), // 001-999
  numero: varchar('numero', { length: 8 }).notNull(), // 00000001-99999999
  puntoVenta: integer('punto_venta').notNull(),
  fecha: timestamp('fecha').defaultNow().notNull(),
  clienteId: uuid('cliente_id'),
  proveedorId: uuid('proveedor_id'),
  monedaId: integer('moneda_id').default(1),
  importeNeto: decimal('importe_neto', { precision: 12, scale: 2 }).notNull().default('0'),
  importeIva: decimal('importe_iva', { precision: 12, scale: 2 }).notNull().default('0'),
  importeTotal: decimal('importe_total', { precision: 12, scale: 2 }).notNull().default('0'),
  detalle: jsonb('detalle'), // items array
 CAE: varchar('cae', { length: 50 }),
  fechaVencimientoCAE: timestamp('fecha_vencimiento_cae'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const planCuentas = pgTable('plan_cuentas', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  codigo: varchar('codigo', { length: 20 }).notNull(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
  tipo: varchar('tipo', { length: 20 }).notNull(), // ACTIVO, PASIVO, PATRIMONIO, INGRESO, GASTO
  naturaleza: varchar('naturaleza', { length: 10 }).notNull(), // DEUDORA, ACREEDORA
  padreId: uuid('padre_id'), // cuenta padre para jerarquía
  nivel: integer('nivel').notNull().default(1),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const asientos = pgTable('asientos', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  numero: integer('numero').notNull(),
  fecha: timestamp('fecha').defaultNow().notNull(),
  detalle: varchar('detalle', { length: 500 }).notNull(),
  lines: jsonb('lines').notNull(), // [{cuentaId, debe, haber}]
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Type exports
export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Cliente = typeof clientes.$inferSelect;
export type Proveedor = typeof proveedores.$inferSelect;
export type Producto = typeof productos.$inferSelect;
export type Comprobante = typeof comprobantes.$inferSelect;
export type Cuenta = typeof planCuentas.$inferSelect;
export type Asiento = typeof asientos.$inferSelect;
