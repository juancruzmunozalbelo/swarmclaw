import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type { AuthUser } from '../middleware/auth';

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginOutput {
  token: string;
  user: {
    id: number;
    email: string;
    rol: string;
  };
}

export async function login(input: LoginInput, generateToken: (user: AuthUser) => string): Promise<LoginOutput | null> {
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

  if (!user || !user.activo) {
    return null;
  }

  const validPassword = await bcrypt.compare(input.password, user.password);

  if (!validPassword) {
    return null;
  }

  const token = generateToken({
    id: user.id,
    email: user.email,
    rol: user.rol,
  });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      rol: user.rol,
    },
  };
}
