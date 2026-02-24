import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './db/schema.js';
import bcrypt from 'bcrypt';
import { productoRoutes } from './routes/productos.js';
import { comprobanteRoutes } from './routes/comprobantes.js';
import { cuentaRoutes } from './routes/cuentas.js';

const { Pool } = pg;

// Database type
type DbType = ReturnType<typeof drizzle>;

// Extend Fastify types - must be before fastify.decorate
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
    db: DbType;
  }
}

// Config
const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/cnt';

// DB Setup
const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

// Build Fastify
const fastify = Fastify({
  logger: true,
});

// Plugins
await fastify.register(cors, { origin: true });
await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });
await fastify.register(jwt, { secret: JWT_SECRET });

// Decorators
fastify.decorate('db', db);

// Register routes
await fastify.register(productoRoutes);
await fastify.register(comprobanteRoutes);
await fastify.register(cuentaRoutes);

fastify.decorate('authenticate', async function (request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized' });
  }
});

// Types
interface LoginBody {
  email: string;
  password: string;
}

interface JwtPayload {
  tenantId: number;
  userId: number;
  email: string;
  rol: string;
}

// Rutas

// Health check
fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// POST /api/v1/auth/login
fastify.post<{ Body: LoginBody }>('/api/v1/auth/login', {
  schema: {
    body: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 1 },
      },
    },
  },
}, async (request, reply) => {
  const { email, password } = request.body;

  try {
    // Buscar usuario por email usando query raw
    const result = await pool.query(
      'SELECT id, tenant_id, email, password_hash, nombre, rol, activo FROM usuarios WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return reply.status(401).send({ error: 'Credenciales inválidas' });
    }

    const usuario = result.rows[0];

    if (!usuario.activo) {
      return reply.status(401).send({ error: 'Usuario inactivo' });
    }

    // Verificar password
    const validPassword = await bcrypt.compare(password, usuario.password_hash);
    if (!validPassword) {
      return reply.status(401).send({ error: 'Credenciales inválidas' });
    }

    // Generar JWT
    const payload: JwtPayload = {
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      email: usuario.email,
      rol: usuario.rol,
    };

    const token = fastify.jwt.sign(payload);

    return {
      success: true,
      token,
      user: {
        tenantId: usuario.tenant_id,
        userId: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        rol: usuario.rol,
      },
    };
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: 'Error interno del servidor' });
  }
});

// Ejemplo de ruta protegida
fastify.get('/api/v1/profile', {
  preHandler: [fastify.authenticate],
}, async (request: any, reply) => {
  const user = request.user as JwtPayload;
  return {
    tenantId: user.tenantId,
    userId: user.userId,
    email: user.email,
    rol: user.rol,
  };
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`Server running on http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
