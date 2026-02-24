import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb, tenants } from '../db/config.js';
import { eq } from 'drizzle-orm';

// Tenant context interface
export interface TenantContext {
  id: string;
  slug: string;
  schemaName: string;
  plan: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

export default async function tenantMiddleware(fastify: FastifyInstance) {
  // Add onRequest hook for all routes except auth
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url;

    // Skip tenant check for auth routes and health
    if (path.startsWith('/api/v1/auth') || path === '/health') {
      return;
    }

    const tenantId = request.headers['x-tenant-id'] as string;
    const apiKey = request.headers['x-api-key'] as string;

    if (!tenantId || !apiKey) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'X-Tenant-ID and X-API-Key headers required',
      });
    }

    try {
      // Get tenant from public schema
      const db = getDb(); // Use public schema (no tenant)

      const tenant = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!tenant) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Tenant not found',
        });
      }

      if (!tenant.active) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Tenant is inactive',
        });
      }

      if (tenant.apiKey !== apiKey) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid API key',
        });
      }

      // Attach tenant context to request
      request.tenant = {
        id: tenant.id,
        slug: tenant.slug,
        schemaName: tenant.schemaName,
        plan: tenant.plan,
      };

      // Attach tenant-specific DB to request
      request.server.tenantDb = getDb(tenant.schemaName);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to validate tenant',
      });
    }
  });
}
