// Script para crear usuario de prueba
// Usage: npx tsx scripts/create-test-user.ts

import { Pool } from 'pg';
import bcrypt from 'bcrypt';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/cnt';

async function createTestUser() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // Generar hash de password
    const password = 'demo123';
    const passwordHash = await bcrypt.hash(password, 10);

    console.log('Password hash:', passwordHash);

    // Crear tenant
    await pool.query(`
      INSERT INTO tenants (nombre, razon_social, nit)
      VALUES ('Empresa Demo', 'Empresa Demo SAS', '12345678901')
      ON CONFLICT DO NOTHING
    `);

    // Crear usuario
    const result = await pool.query(`
      INSERT INTO usuarios (tenant_id, email, password_hash, nombre, rol, activo)
      VALUES (1, $1, $2, 'Administrador', 'admin', true)
      ON CONFLICT DO NOTHING
      RETURNING id, email, nombre, rol
    `, ['admin@demo.com', passwordHash]);

    console.log('Usuario creado:', result.rows[0]);
    console.log('\nCredenciales de prueba:');
    console.log('  Email: admin@demo.com');
    console.log('  Password: demo123');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

createTestUser();
