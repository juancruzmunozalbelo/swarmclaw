import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, ilike, asc } from 'drizzle-orm';
import * as schema from '../db/schema.js';

// Types
interface ProductoParams {
  id: string;
}

interface ProductoCreateBody {
  codigo?: string;
  nombre: string;
  descripcion?: string;
  tipo?: 'producto' | 'servicio';
  precioVenta?: string | number;
  precioCosto?: string | number;
  stock?: number;
  unidad?: string;
}

interface ProductoUpdateBody {
  codigo?: string;
  nombre?: string;
  descripcion?: string;
  tipo?: 'producto' | 'servicio';
  precioVenta?: string | number;
  precioCosto?: string | number;
  stock?: number;
  unidad?: string;
  activo?: boolean;
}

interface ProductoListQuery {
  search?: string;
  tipo?: string;
  activo?: string;
  page?: string;
  limit?: string;
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
function errorResponse(reply: FastifyReply, statusCode: number, message: string) {
  return reply.status(statusCode).send({
    success: false,
    error: message,
  });
}

export async function productoRoutes(fastify: FastifyInstance) {

  // ============================================
  // GET /api/v1/productos - Listar productos
  // ============================================
  fastify.get<{ Querystring: ProductoListQuery }>(
    '/api/v1/productos',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { search, tipo, activo, page = '1', limit = '20' } = request.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;

        // Construir condiciones
        const conditions: any[] = [eq(schema.productos.tenantId, tenantId)];

        if (search) {
          conditions.push(ilike(schema.productos.nombre, `%${search}%`));
        }
        if (tipo) {
          conditions.push(eq(schema.productos.tipo, tipo));
        }
        if (activo !== undefined) {
          conditions.push(eq(schema.productos.activo, activo === 'true'));
        }

        // Query con paginación
        const productos = await getDb(fastify).query.productos.findMany({
          where: and(...conditions),
          orderBy: [asc(schema.productos.nombre)],
          limit: limitNum,
          offset,
        });

        // Contar total
        const countResult = await getDb(fastify)
          .select({ count: schema.productos.id })
          .from(schema.productos)
          .where(and(...conditions));

        const total = countResult.length;

        return successResponse({
          items: productos,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
          },
        });
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al listar productos');
      }
    }
  );

  // ============================================
  // GET /api/v1/productos/:id - Obtener producto por ID
  // ============================================
  fastify.get<{ Params: ProductoParams }>(
    '/api/v1/productos/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;
        const productoId = parseInt(id);

        if (isNaN(productoId)) {
          return errorResponse(reply, 400, 'ID de producto inválido');
        }

        const producto = await getDb(fastify).query.productos.findFirst({
          where: and(
            eq(schema.productos.id, productoId),
            eq(schema.productos.tenantId, tenantId)
          ),
        });

        if (!producto) {
          return errorResponse(reply, 404, 'Producto no encontrado');
        }

        return successResponse(producto);
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al obtener producto');
      }
    }
  );

  // ============================================
  // POST /api/v1/productos - Crear producto
  // ============================================
  fastify.post<{ Body: ProductoCreateBody }>(
    '/api/v1/productos',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['nombre'],
          properties: {
            codigo: { type: 'string', maxLength: 50 },
            nombre: { type: 'string', maxLength: 255 },
            descripcion: { type: 'string' },
            tipo: { type: 'string', enum: ['producto', 'servicio'] },
            precioVenta: { type: ['string', 'number'] },
            precioCosto: { type: ['string', 'number'] },
            stock: { type: 'integer' },
            unidad: { type: 'string', maxLength: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { codigo, nombre, descripcion, tipo, precioVenta, precioCosto, stock, unidad } = request.body;

        // VALIDACIÓN CNT-021: Código único por tenant
        if (codigo) {
          const existingProducto = await getDb(fastify).query.productos.findFirst({
            where: and(
              eq(schema.productos.tenantId, tenantId),
              eq(schema.productos.codigo, codigo)
            ),
          });

          if (existingProducto) {
            return reply.status(409).send({
              success: false,
              error: 'El código del producto ya existe',
              code: 'DUPLICATE_CODE',
            });
          }
        }

        // Crear producto
        const result = await getDb(fastify).insert(schema.productos).values({
          tenantId,
          codigo: codigo || null,
          nombre,
          descripcion: descripcion || null,
          tipo: tipo || 'producto',
          precioVenta: precioVenta ? String(precioVenta) : null,
          precioCosto: precioCosto ? String(precioCosto) : null,
          stock: stock ?? 0,
          unidad: unidad || null,
          activo: true,
        }).returning();

        const producto = result[0];

        request.log.info({ productoId: producto.id }, 'Producto creado');
        return reply.status(201).send(successResponse(producto, 'Producto creado correctamente'));
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al crear producto');
      }
    }
  );

  // ============================================
  // PUT /api/v1/productos/:id - Actualizar producto
  // ============================================
  fastify.put<{ Params: ProductoParams; Body: ProductoUpdateBody }>(
    '/api/v1/productos/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;
        const productoId = parseInt(id);

        if (isNaN(productoId)) {
          return errorResponse(reply, 400, 'ID de producto inválido');
        }

        // Verificar que existe
        const existingProducto = await getDb(fastify).query.productos.findFirst({
          where: and(
            eq(schema.productos.id, productoId),
            eq(schema.productos.tenantId, tenantId)
          ),
        });

        if (!existingProducto) {
          return errorResponse(reply, 404, 'Producto no encontrado');
        }

        const { codigo, nombre, descripcion, tipo, precioVenta, precioCosto, stock, unidad, activo } = request.body;

        // VALIDACIÓN CNT-021: Código único al actualizar
        if (codigo && codigo !== existingProducto.codigo) {
          const duplicateCode = await getDb(fastify).query.productos.findFirst({
            where: and(
              eq(schema.productos.tenantId, tenantId),
              eq(schema.productos.codigo, codigo)
            ),
          });

          if (duplicateCode) {
            return reply.status(409).send({
              success: false,
              error: 'El código del producto ya existe',
              code: 'DUPLICATE_CODE',
            });
          }
        }

        // Actualizar producto
        const updateData: any = {
          updatedAt: new Date(),
        };

        if (codigo !== undefined) updateData.codigo = codigo || null;
        if (nombre !== undefined) updateData.nombre = nombre;
        if (descripcion !== undefined) updateData.descripcion = descripcion || null;
        if (tipo !== undefined) updateData.tipo = tipo;
        if (precioVenta !== undefined) updateData.precioVenta = precioVenta ? String(precioVenta) : null;
        if (precioCosto !== undefined) updateData.precioCosto = precioCosto ? String(precioCosto) : null;
        if (stock !== undefined) updateData.stock = stock;
        if (unidad !== undefined) updateData.unidad = unidad || null;
        if (activo !== undefined) updateData.activo = activo;

        const result = await getDb(fastify)
          .update(schema.productos)
          .set(updateData)
          .where(and(
            eq(schema.productos.id, productoId),
            eq(schema.productos.tenantId, tenantId)
          ))
          .returning();

        const producto = result[0];

        return successResponse(producto, 'Producto actualizado correctamente');
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al actualizar producto');
      }
    }
  );

  // ============================================
  // DELETE /api/v1/productos/:id - Eliminar producto
  // ============================================
  fastify.delete<{ Params: ProductoParams }>(
    '/api/v1/productos/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;
        const productoId = parseInt(id);

        if (isNaN(productoId)) {
          return errorResponse(reply, 400, 'ID de producto inválido');
        }

        // Verificar que existe
        const existingProducto = await getDb(fastify).query.productos.findFirst({
          where: and(
            eq(schema.productos.id, productoId),
            eq(schema.productos.tenantId, tenantId)
          ),
        });

        if (!existingProducto) {
          return errorResponse(reply, 404, 'Producto no encontrado');
        }

        // Eliminar producto
        await getDb(fastify)
          .delete(schema.productos)
          .where(and(
            eq(schema.productos.id, productoId),
            eq(schema.productos.tenantId, tenantId)
          ));

        return successResponse({ id: productoId }, 'Producto eliminado correctamente');
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al eliminar producto');
      }
    }
  );
}
