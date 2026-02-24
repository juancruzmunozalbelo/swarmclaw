import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config } from 'dotenv';

// Load environment variables
config();

// Routes
import authRoutes from './routes/auth.js';
import clientesRoutes from './routes/clientes.js';
import proveedoresRoutes from './routes/proveedores.js';
import productosRoutes from './routes/productos.js';
import comprobantesRoutes from './routes/comprobantes.js';
import cuentasRoutes from './routes/cuentas.js';
import asientosRoutes from './routes/asientos.js';

// Middleware
import tenantMiddleware from './middleware/tenant.js';

const fastify = Fastify({
  logger: true,
});

// Register plugins
await fastify.register(cors, {
  origin: true,
});

// Rate limiting
await fastify.register(rateLimit, {
  max: parseInt(process.env.RATE_LIMIT_STANDARD || '100'),
  timeWindow: '1 minute',
});

// JWT
await fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'fallback-secret-key-change-in-production',
});

// Tenant middleware
await fastify.register(tenantMiddleware);

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Auth routes (no tenant required)
fastify.register(authRoutes, { prefix: '/api/v1/auth' });

// Protected routes (tenant required)
fastify.register(clientesRoutes, { prefix: '/api/v1/clientes' });
fastify.register(proveedoresRoutes, { prefix: '/api/v1/proveedores' });
fastify.register(productosRoutes, { prefix: '/api/v1/productos' });
fastify.register(comprobantesRoutes, { prefix: '/api/v1/comprobantes' });
fastify.register(cuentasRoutes, { prefix: '/api/v1/cuentas' });
fastify.register(asientosRoutes, { prefix: '/api/v1/asientos' });

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001');
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    console.log(`Server running on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
