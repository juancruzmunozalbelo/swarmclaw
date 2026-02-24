import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, asc, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';

// Types
interface CuentaParams {
  id: string;
}

interface CuentaCreateBody {
  codigo: string;
  nombre: string;
  tipo: 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'gasto';
  naturaleza: 'deudora' | 'acreedora';
  padreId?: number;
}

interface CuentaUpdateBody {
  codigo?: string;
  nombre?: string;
  tipo?: 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'gasto';
  naturaleza?: 'deudora' | 'acreedora';
  padreId?: number | null;
}

interface CuentaListQuery {
  activo?: string;
}

// Helper para acceder a db con tipos
function getDb(fastify: FastifyInstance): any {
  return (fastify as any).db;
}

// Helper para obtener tenantId del header
function getTenantId(request: FastifyRequest): number {
  const tenantIdHeader = request.headers['x-tenant-id'];
  const tenantId = parseInt(tenantIdHeader as string);
  if (isNaN(tenantId)) {
    throw new Error('X-Tenant-ID header inválido');
  }
  return tenantId;
}

// Response helper
function successResponse(data: any, message?: string) {
  return {
    success: true,
    ...(message && { message }),
    data,
  };
}

// Error response
function errorResponse(reply: FastifyReply, statusCode: number, message: string, code?: string) {
  return reply.status(statusCode).send({
    success: false,
    error: message,
    ...(code && { code }),
  });
}

// Función para construir árbol jerárquico
function buildTree(cuentas: any[]): any[] {
  const map = new Map<number, any>();
  const roots: any[] = [];

  // Primero crear nodos con hijos vacíos
  cuentas.forEach((cuenta) => {
    map.set(cuenta.id, { ...cuenta, hijos: [] });
  });

  // Luego relacionar padres con hijos
  cuentas.forEach((cuenta) => {
    const nodo = map.get(cuenta.id);
    if (cuenta.padreId && map.has(cuenta.padreId)) {
      map.get(cuenta.padreId).hijos.push(nodo);
    } else {
      roots.push(nodo);
    }
  });

  return roots;
}

// Función para verificar si una cuenta tiene movimientos
async function cuentaTieneMovimientos(fastify: FastifyInstance, cuentaId: number, tenantId: number): Promise<boolean> {
  const result = await getDb(fastify)
    .select({ count: sql<number>`count(*)` })
    .from(schema.asientoLineas)
    .innerJoin(schema.asientos, eq(schema.asientos.id, schema.asientoLineas.asientoId))
    .where(and(
      eq(schema.asientoLineas.cuentaId, cuentaId),
      eq(schema.asientos.tenantId, tenantId)
    ));

  const count = result[0]?.count || 0;
  return count > 0;
}

export async function cuentaRoutes(fastify: FastifyInstance) {

  // ============================================
  // GET /api/v1/cuentas - Listar todas las cuentas (árbol jerárquico)
  // ============================================
  fastify.get<{ Querystring: CuentaListQuery }>(
    '/api/v1/cuentas',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { activo } = request.query;

        // Construir condiciones
        const conditions: any[] = [eq(schema.cuentas.tenantId, tenantId)];

        if (activo !== undefined) {
          conditions.push(eq(schema.cuentas.activo, activo === 'true'));
        }

        // Obtener todas las cuentas ordenadas por código
        const cuentas = await getDb(fastify).query.cuentas.findMany({
          where: and(...conditions),
          orderBy: [asc(schema.cuentas.codigo)],
        });

        // Construir árbol
        const tree = buildTree(cuentas);

        return successResponse(tree);
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al listar cuentas');
      }
    }
  );

  // ============================================
  // GET /api/v1/cuentas/:id - Obtener cuenta por ID
  // ============================================
  fastify.get<{ Params: CuentaParams }>(
    '/api/v1/cuentas/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;
        const cuentaId = parseInt(id);

        if (isNaN(cuentaId)) {
          return errorResponse(reply, 400, 'ID de cuenta inválido');
        }

        const cuenta = await getDb(fastify).query.cuentas.findFirst({
          where: and(
            eq(schema.cuentas.id, cuentaId),
            eq(schema.cuentas.tenantId, tenantId)
          ),
        });

        if (!cuenta) {
          return errorResponse(reply, 404, 'Cuenta no encontrada');
        }

        // Obtener hijos directos si es padre
        const hijos = await getDb(fastify).query.cuentas.findMany({
          where: and(
            eq(schema.cuentas.padreId, cuentaId),
            eq(schema.cuentas.tenantId, tenantId)
          ),
          orderBy: [asc(schema.cuentas.codigo)],
        });

        return successResponse({
          ...cuenta,
          hijos,
        });
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al obtener cuenta');
      }
    }
  );

  // ============================================
  // POST /api/v1/cuentas - Crear cuenta
  // ============================================
  fastify.post<{ Body: CuentaCreateBody }>(
    '/api/v1/cuentas',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['codigo', 'nombre', 'tipo', 'naturaleza'],
          properties: {
            codigo: { type: 'string', maxLength: 20 },
            nombre: { type: 'string', maxLength: 255 },
            tipo: { type: 'string', enum: ['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto'] },
            naturaleza: { type: 'string', enum: ['deudora', 'acreedora'] },
            padreId: { type: 'integer' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { codigo, nombre, tipo, naturaleza, padreId } = request.body;

        // VALIDACIÓN CNT-040: Código único por tenant
        const existingCuenta = await getDb(fastify).query.cuentas.findFirst({
          where: and(
            eq(schema.cuentas.tenantId, tenantId),
            eq(schema.cuentas.codigo, codigo)
          ),
        });

        if (existingCuenta) {
          return reply.status(409).send({
            success: false,
            error: 'El código de cuenta ya existe',
            code: 'DUPLICATE_CODE',
          });
        }

        // Calcular nivel si tiene padre
        let nivel = 1;
        if (padreId) {
          const padre = await getDb(fastify).query.cuentas.findFirst({
            where: and(
              eq(schema.cuentas.id, padreId),
              eq(schema.cuentas.tenantId, tenantId)
            ),
          });
          if (padre) {
            nivel = padre.nivel + 1;
          }
        }

        // Crear cuenta
        const result = await getDb(fastify).insert(schema.cuentas).values({
          tenantId,
          codigo,
          nombre,
          tipo,
          naturaleza,
          padreId: padreId || null,
          nivel,
          activo: true,
        }).returning();

        const cuenta = result[0];

        request.log.info({ cuentaId: cuenta.id }, 'Cuenta creada');
        return reply.status(201).send(successResponse(cuenta, 'Cuenta creada correctamente'));
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al crear cuenta');
      }
    }
  );

  // ============================================
  // PUT /api/v1/cuentas/:id - Actualizar cuenta
  // ============================================
  fastify.put<{ Params: CuentaParams; Body: CuentaUpdateBody }>(
    '/api/v1/cuentas/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;
        const cuentaId = parseInt(id);

        if (isNaN(cuentaId)) {
          return errorResponse(reply, 400, 'ID de cuenta inválido');
        }

        // Verificar que existe
        const existingCuenta = await getDb(fastify).query.cuentas.findFirst({
          where: and(
            eq(schema.cuentas.id, cuentaId),
            eq(schema.cuentas.tenantId, tenantId)
          ),
        });

        if (!existingCuenta) {
          return errorResponse(reply, 404, 'Cuenta no encontrada');
        }

        const { codigo, nombre, tipo, naturaleza, padreId } = request.body;

        // VALIDACIÓN CNT-040: Código único al actualizar
        if (codigo && codigo !== existingCuenta.codigo) {
          const duplicateCode = await getDb(fastify).query.cuentas.findFirst({
            where: and(
              eq(schema.cuentas.tenantId, tenantId),
              eq(schema.cuentas.codigo, codigo)
            ),
          });

          if (duplicateCode) {
            return reply.status(409).send({
              success: false,
              error: 'El código de cuenta ya existe',
              code: 'DUPLICATE_CODE',
            });
          }
        }

        // Actualizar datos
        const updateData: any = {
          updatedAt: new Date(),
        };

        if (codigo !== undefined) updateData.codigo = codigo;
        if (nombre !== undefined) updateData.nombre = nombre;
        if (tipo !== undefined) updateData.tipo = tipo;
        if (naturaleza !== undefined) updateData.naturaleza = naturaleza;
        if (padreId !== undefined) {
          // Si cambia el padre, recalcular nivel
          if (padreId === null) {
            updateData.padreId = null;
            updateData.nivel = 1;
          } else {
            const nuevoPadre = await getDb(fastify).query.cuentas.findFirst({
              where: and(
                eq(schema.cuentas.id, padreId),
                eq(schema.cuentas.tenantId, tenantId)
              ),
            });
            if (nuevoPadre) {
              updateData.padreId = padreId;
              updateData.nivel = nuevoPadre.nivel + 1;
            }
          }
        }

        const result = await getDb(fastify)
          .update(schema.cuentas)
          .set(updateData)
          .where(and(
            eq(schema.cuentas.id, cuentaId),
            eq(schema.cuentas.tenantId, tenantId)
          ))
          .returning();

        const cuenta = result[0];

        return successResponse(cuenta, 'Cuenta actualizada correctamente');
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al actualizar cuenta');
      }
    }
  );

  // ============================================
  // DELETE /api/v1/cuentas/:id - Soft delete (inactivar cuenta)
  // ============================================
  fastify.delete<{ Params: CuentaParams }>(
    '/api/v1/cuentas/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;
        const cuentaId = parseInt(id);

        if (isNaN(cuentaId)) {
          return errorResponse(reply, 400, 'ID de cuenta inválido');
        }

        // Verificar que existe
        const existingCuenta = await getDb(fastify).query.cuentas.findFirst({
          where: and(
            eq(schema.cuentas.id, cuentaId),
            eq(schema.cuentas.tenantId, tenantId)
          ),
        });

        if (!existingCuenta) {
          return errorResponse(reply, 404, 'Cuenta no encontrada');
        }

        // VALIDACIÓN CNT-040: No eliminar cuenta que tenga movimientos
        const tieneMovimientos = await cuentaTieneMovimientos(fastify, cuentaId, tenantId);
        if (tieneMovimientos) {
          return errorResponse(
            reply,
            422,
            'No se puede eliminar la cuenta porque tiene movimientos asociados',
            'CUENTA_CON_MOVIMIENTOS'
          );
        }

        // Soft delete: marcar como inactiva
        const result = await getDb(fastify)
          .update(schema.cuentas)
          .set({
            activo: false,
            updatedAt: new Date(),
          })
          .where(and(
            eq(schema.cuentas.id, cuentaId),
            eq(schema.cuentas.tenantId, tenantId)
          ))
          .returning();

        const cuenta = result[0];

        return successResponse({ ...cuenta, activo: false }, 'Cuenta marcada como inactiva');
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al eliminar cuenta');
      }
    }
  );
}
