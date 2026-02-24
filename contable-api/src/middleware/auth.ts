import { FastifyRequest, FastifyReply } from 'fastify';

export interface AuthUser {
  id: number;
  email: string;
  rol: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or missing token' });
  }
}
