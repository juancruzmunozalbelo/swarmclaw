import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, desc, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';

// ============================================
// Tipos e Interfaces
// ============================================

interface ComprobanteParams {
  id: string;
}

interface ComprobanteCreateBody {
  tipo: 'FV' | 'FC' | 'NCA' | 'NCF' | 'NDA' | 'NDP';
  clienteId?: number;
  proveedorId?: number;
  letra?: string;
  puntoVenta?: number;
  fechaEmision?: string;
  subtotal?: string | number;
  iva?: string | number;
  total: string | number;
  observaciones?: string;
  fechaVencimiento?: string;
  comprobanteOriginalId?: number; // Para notas de crédito
  items?: Array<{
    productoId: number;
    cantidad: number;
    precioUnitario: string | number;
    iva?: string | number;
    subtotal: string | number;
  }>;
}

interface AnularBody {
  motivo?: string;
}

interface ComprobanteListQuery {
  tipo?: string;
  clienteId?: string;
  proveedorId?: string;
  estado?: string;
  page?: string;
  limit?: string;
  fechaDesde?: string;
  fechaHasta?: string;
}

// ============================================
// Helpers
// ============================================

function getDb(fastify: FastifyInstance): any {
  return (fastify as any).db;
}

function getTenantId(request: FastifyRequest): number {
  const tenantIdHeader = request.headers['x-tenant-id'];
  const tenantId = parseInt(tenantIdHeader as string);
  if (isNaN(tenantId)) {
    throw new Error('X-Tenant-ID header inválido');
  }
  return tenantId;
}

function successResponse(data: any, message?: string) {
  return {
    success: true,
    ...(message && { message }),
    data,
  };
}

function errorResponse(reply: FastifyReply, statusCode: number, message: string, code?: string) {
  return reply.status(statusCode).send({
    success: false,
    error: message,
    ...(code && { code }),
  });
}

// Generar número correlativo para comprobantes
async function generarNumeroComprobante(
  db: any,
  tenantId: number,
  tipo: string
): Promise<string> {
  // Obtener el último número para este tipo de comprobante
  const ultimoComprobante = await db.query.comprobantes.findFirst({
    where: and(
      eq(schema.comprobantes.tenantId, tenantId),
      eq(schema.comprobantes.tipo, tipo)
    ),
    orderBy: [desc(schema.comprobantes.id)],
  });

  let numero = 1;
  if (ultimoComprobante) {
    const partes = ultimoComprobante.numero.split('-');
    if (partes.length === 2) {
      numero = parseInt(partes[1], 10) + 1;
    }
  }

  // Formato: 001-00000001
  const puntoVenta = '001';
  const numeroStr = String(numero).padStart(8, '0');
  return `${puntoVenta}-${numeroStr}`;
}

export async function comprobanteRoutes(fastify: FastifyInstance) {

  // ============================================
  // GET /api/v1/comprobantes - Listar comprobantes
  // ============================================
  fastify.get<{ Querystring: ComprobanteListQuery }>(
    '/api/v1/comprobantes',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { tipo, clienteId, proveedorId, estado, page = '1', limit = '20', fechaDesde, fechaHasta } = request.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;

        const conditions: any[] = [eq(schema.comprobantes.tenantId, tenantId)];

        if (tipo) {
          conditions.push(eq(schema.comprobantes.tipo, tipo));
        }
        if (clienteId) {
          conditions.push(eq(schema.comprobantes.clienteId, parseInt(clienteId)));
        }
        if (proveedorId) {
          conditions.push(eq(schema.comprobantes.proveedorId, parseInt(proveedorId)));
        }
        if (estado) {
          conditions.push(eq(schema.comprobantes.estado, estado));
        }
        if (fechaDesde) {
          conditions.push(sql`${schema.comprobantes.fecha} >= ${fechaDesde}`);
        }
        if (fechaHasta) {
          conditions.push(sql`${schema.comprobantes.fecha} <= ${fechaHasta}`);
        }

        const comprobantes = await getDb(fastify).query.comprobantes.findMany({
          where: and(...conditions),
          orderBy: [desc(schema.comprobantes.fecha)],
          limit: limitNum,
          offset,
          with: {
            cliente: true,
            proveedor: true,
          },
        });

        const countResult = await getDb(fastify)
          .select({ count: schema.comprobantes.id })
          .from(schema.comprobantes)
          .where(and(...conditions));

        const total = countResult.length;

        return successResponse({
          items: comprobantes,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
          },
        });
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al listar comprobantes');
      }
    }
  );

  // ============================================
  // GET /api/v1/comprobantes/:id - Obtener comprobante
  // ============================================
  fastify.get<{ Params: ComprobanteParams }>(
    '/api/v1/comprobantes/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;
        const comprobanteId = parseInt(id);

        if (isNaN(comprobanteId)) {
          return errorResponse(reply, 400, 'ID de comprobante inválido');
        }

        const comprobante = await getDb(fastify).query.comprobantes.findFirst({
          where: and(
            eq(schema.comprobantes.id, comprobanteId),
            eq(schema.comprobantes.tenantId, tenantId)
          ),
          with: {
            cliente: true,
            proveedor: true,
          },
        });

        if (!comprobante) {
          return errorResponse(reply, 404, 'Comprobante no encontrado');
        }

        return successResponse(comprobante);
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al obtener comprobante');
      }
    }
  );

  // ============================================
  // POST /api/v1/comprobantes - Crear comprobante
  // Maneja CNT-031 (Factura C) y CNT-032 (Notas de Crédito)
  // ============================================
  fastify.post<{ Body: ComprobanteCreateBody }>(
    '/api/v1/comprobantes',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['tipo', 'total'],
          properties: {
            tipo: { type: 'string', enum: ['FV', 'FC', 'NCA', 'NCF', 'NDA', 'NDP'] },
            clienteId: { type: 'integer' },
            proveedorId: { type: 'integer' },
            letra: { type: 'string', maxLength: 1 },
            puntoVenta: { type: 'integer' },
            fechaEmision: { type: 'string' },
            subtotal: { type: ['string', 'number'] },
            iva: { type: ['string', 'number'] },
            total: { type: ['string', 'number'] },
            observaciones: { type: 'string' },
            fechaVencimiento: { type: 'string' },
            comprobanteOriginalId: { type: 'integer' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  productoId: { type: 'integer' },
                  cantidad: { type: 'integer' },
                  precioUnitario: { type: ['string', 'number'] },
                  iva: { type: ['string', 'number'] },
                  subtotal: { type: ['string', 'number'] },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const {
          tipo,
          clienteId,
          proveedorId,
          letra,
          puntoVenta,
          fechaEmision,
          subtotal,
          iva,
          total,
          observaciones,
          fechaVencimiento,
          comprobanteOriginalId,
          items,
        } = request.body;

        // ============================================
        // CNT-031: Validar cliente activo para Factura C
        // ============================================
        if (tipo === 'FC' && clienteId) {
          const cliente = await getDb(fastify).query.clientes.findFirst({
            where: and(
              eq(schema.clientes.id, clienteId),
              eq(schema.clientes.tenantId, tenantId)
            ),
          });

          if (!cliente) {
            return errorResponse(reply, 404, 'Cliente no encontrado', 'CLIENTE_NOT_FOUND');
          }

          if (!cliente.activo) {
            return errorResponse(reply, 400, 'El cliente debe estar activo para emitir Factura C', 'CLIENTE_INACTIVE');
          }
        }

        // ============================================
        // CNT-032: Validar comprobante original para Notas de Crédito
        // ============================================
        if ((tipo === 'NCA' || tipo === 'NCF') && comprobanteOriginalId) {
          const comprobanteOriginal = await getDb(fastify).query.comprobantes.findFirst({
            where: and(
              eq(schema.comprobantes.id, comprobanteOriginalId),
              eq(schema.comprobantes.tenantId, tenantId)
            ),
          });

          if (!comprobanteOriginal) {
            return errorResponse(reply, 404, 'Comprobante original no encontrado', 'ORIGINAL_NOT_FOUND');
          }

          if (comprobanteOriginal.estado === 'anulado') {
            return errorResponse(reply, 400, 'No se puede crear nota de crédito sobre un comprobante anulado', 'ORIGINAL_ANULADO');
          }

          // Validar que el tipo de comprobante sea compatible
          if (tipo === 'NCA' && !comprobanteOriginal.clienteId) {
            return errorResponse(reply, 400, 'El comprobante original debe tener un cliente para Nota de Crédito Cliente', 'INVALID_ORIGINAL_TYPE');
          }

          if (tipo === 'NCF' && !comprobanteOriginal.proveedorId) {
            return errorResponse(reply, 400, 'El comprobante original debe tener un proveedor para Nota de Crédito Proveedor', 'INVALID_ORIGINAL_TYPE');
          }
        }

        // ============================================
        // Generar número correlativo
        // FV = Factura A (IVA Responsable Inscripto)
        // FC = Factura C (IVA Responsable Monotributo / Consumidor Final)
        // NCA = Nota de Crédito Cliente (para FV)
        // NCF = Nota de Crédito Proveedor
        // NDA = Nota de Débito Cliente
        // NDP = Nota de Débito Proveedor
        // ============================================
        let numero: string;

        if (tipo === 'FC') {
          // FC tiene numeración separada de FV
          numero = await generarNumeroComprobante(getDb(fastify), tenantId, 'FC');
        } else if (tipo === 'NCA' || tipo === 'NCF') {
          // Notas de crédito tienen numeración separada
          numero = await generarNumeroComprobante(getDb(fastify), tenantId, tipo);
        } else {
          // FV y otros
          numero = await generarNumeroComprobante(getDb(fastify), tenantId, tipo);
        }

        // Preparar datos adicionales en JSON
        const jsonData: any = {
          letra: letra || (tipo === 'FC' ? 'C' : 'A'),
          puntoVenta: puntoVenta || 1,
          subtotal: subtotal || 0,
          iva: iva || 0,
          observaciones,
          fechaVencimiento,
          items: items || [],
        };

        // Crear comprobante
        const result = await getDb(fastify).insert(schema.comprobantes).values({
          tenantId,
          tipo,
          numero,
          serie: jsonData.letra,
          clienteId: clienteId || null,
          proveedorId: proveedorId || null,
          fecha: fechaEmision ? new Date(fechaEmision) : new Date(),
          total: String(total),
          estado: 'vigente',
          jsonData: JSON.stringify(jsonData),
        }).returning();

        const comprobante = result[0];

        // ============================================
        // CNT-032: Actualizar comprobante original si es nota de crédito
        // ============================================
        if ((tipo === 'NCA' || tipo === 'NCF') && comprobanteOriginalId) {
          // Obtener el total original
          const original = await getDb(fastify).query.comprobantes.findFirst({
            where: eq(schema.comprobantes.id, comprobanteOriginalId),
          });

          if (original) {
            // Calcular nuevo total restando
            const totalOriginal = parseFloat(String(original.total));
            const totalNotaCredito = parseFloat(String(total));
            const nuevoTotal = Math.max(0, totalOriginal - totalNotaCredito);

            await getDb(fastify)
              .update(schema.comprobantes)
              .set({
                total: String(nuevoTotal),
                updatedAt: new Date(),
              })
              .where(eq(schema.comprobantes.id, comprobanteOriginalId));
          }
        }

        request.log.info({ comprobanteId: comprobante.id, tipo }, 'Comprobante creado');
        return reply.status(201).send(successResponse(comprobante, 'Comprobante creado correctamente'));
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al crear comprobante');
      }
    }
  );

  // ============================================
  // POST /api/v1/comprobantes/:id/anular - CNT-030
  // Anular comprobante
  // ============================================
  fastify.post<{ Params: ComprobanteParams; Body: AnularBody }>(
    '/api/v1/comprobantes/:id/anular',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          properties: {
            motivo: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;
        const comprobanteId = parseInt(id);
        const { motivo } = request.body || {};

        if (isNaN(comprobanteId)) {
          return errorResponse(reply, 400, 'ID de comprobante inválido');
        }

        // Verificar que el comprobante existe
        const comprobanteExistente = await getDb(fastify).query.comprobantes.findFirst({
          where: and(
            eq(schema.comprobantes.id, comprobanteId),
            eq(schema.comprobantes.tenantId, tenantId)
          ),
        });

        if (!comprobanteExistente) {
          return errorResponse(reply, 404, 'Comprobante no encontrado');
        }

        // Validar que no esté ya anulado
        if (comprobanteExistente.estado === 'anulado') {
          return errorResponse(reply, 400, 'El comprobante ya está anulado', 'ALREADY_ANULADO');
        }

        // Marcar como anulado
        const result = await getDb(fastify)
          .update(schema.comprobantes)
          .set({
            estado: 'anulado',
            updatedAt: new Date(),
          })
          .where(and(
            eq(schema.comprobantes.id, comprobanteId),
            eq(schema.comprobantes.tenantId, tenantId)
          ))
          .returning();

        const comprobante = result[0];

        // Guardar motivo de anulación en jsonData si se proporcionó
        if (motivo) {
          const jsonData = comprobanteExistente.jsonData ? JSON.parse(comprobanteExistente.jsonData) : {};
          jsonData.motivoAnulacion = motivo;
          jsonData.fechaAnulacion = new Date().toISOString();

          await getDb(fastify)
            .update(schema.comprobantes)
            .set({ jsonData: JSON.stringify(jsonData) })
            .where(eq(schema.comprobantes.id, comprobanteId));
        }

        request.log.info({ comprobanteId, motivo }, 'Comprobante anulado');
        return successResponse(comprobante, 'Comprobante anulado correctamente');
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al anular comprobante');
      }
    }
  );

  // ============================================
  // PUT /api/v1/comprobantes/:id - Actualizar comprobante
  // ============================================
  fastify.put<{ Params: ComprobanteParams; Body: Partial<ComprobanteCreateBody> }>(
    '/api/v1/comprobantes/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;
        const comprobanteId = parseInt(id);

        if (isNaN(comprobanteId)) {
          return errorResponse(reply, 400, 'ID de comprobante inválido');
        }

        const comprobanteExistente = await getDb(fastify).query.comprobantes.findFirst({
          where: and(
            eq(schema.comprobantes.id, comprobanteId),
            eq(schema.comprobantes.tenantId, tenantId)
          ),
        });

        if (!comprobanteExistente) {
          return errorResponse(reply, 404, 'Comprobante no encontrado');
        }

        // No se puede modificar un comprobante anulado
        if (comprobanteExistente.estado === 'anulado') {
          return errorResponse(reply, 400, 'No se puede modificar un comprobante anulado');
        }

        const {
          tipo,
          clienteId,
          proveedorId,
          letra,
          puntoVenta,
          fechaEmision,
          subtotal,
          iva,
          total,
          observaciones,
          fechaVencimiento,
        } = request.body;

        // Actualizar jsonData
        const jsonDataExistente = comprobanteExistente.jsonData ? JSON.parse(comprobanteExistente.jsonData) : {};
        const jsonDataNuevo = {
          ...jsonDataExistente,
          ...(letra && { letra }),
          ...(puntoVenta && { puntoVenta }),
          ...(subtotal !== undefined && { subtotal }),
          ...(iva !== undefined && { iva }),
          ...(observaciones && { observaciones }),
          ...(fechaVencimiento && { fechaVencimiento }),
        };

        const updateData: any = {
          updatedAt: new Date(),
        };

        if (tipo !== undefined) updateData.tipo = tipo;
        if (clienteId !== undefined) updateData.clienteId = clienteId || null;
        if (proveedorId !== undefined) updateData.proveedorId = proveedorId || null;
        if (letra !== undefined) updateData.serie = letra;
        if (fechaEmision !== undefined) updateData.fecha = new Date(fechaEmision);
        if (total !== undefined) updateData.total = String(total);
        if (Object.keys(jsonDataNuevo).length > 0) updateData.jsonData = JSON.stringify(jsonDataNuevo);

        const result = await getDb(fastify)
          .update(schema.comprobantes)
          .set(updateData)
          .where(and(
            eq(schema.comprobantes.id, comprobanteId),
            eq(schema.comprobantes.tenantId, tenantId)
          ))
          .returning();

        const comprobante = result[0];

        return successResponse(comprobante, 'Comprobante actualizado correctamente');
      } catch (error: any) {
        request.log.error(error);
        return errorResponse(reply, 500, error.message || 'Error al actualizar comprobante');
      }
    }
  );
}
