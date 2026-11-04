import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV:z.enum(['development','production','test']).default('development'),
  PORT:z.coerce.number().default(4000),
  WEB_URL:z.string().url().default('http://localhost:5173'),
  API_URL:z.string().url().default('http://localhost:4000'),
  DATABASE_URL:z.string().min(1),
  SUPABASE_URL:z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY:z.string().min(1),
  TOKEN_ENCRYPTION_KEY:z.string().regex(/^[a-fA-F0-9]{64}$/),
  GOTO_CLIENT_ID:z.string().optional().default(''),
  GOTO_CLIENT_SECRET:z.string().optional().default(''),
  GOTO_REDIRECT_URI:z.string().optional().default(''),
  GOTO_WEBHOOK_SECRET:z.string().optional().default('')
});
export const env=envSchema.parse(process.env);
