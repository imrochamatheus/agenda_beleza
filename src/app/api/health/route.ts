import { obterPrisma } from '@/server/db';
import { verificarBanco } from '@/server/health';

// Lê o banco a cada chamada; nunca é pré-renderizada no build.
export const dynamic = 'force-dynamic';

/** Público por definição (RN-10). O corpo 503 não traz mensagem, host nem credencial. */
export async function GET(): Promise<Response> {
  let saudavel = false;
  try {
    saudavel = await verificarBanco(obterPrisma());
  } catch {
    // DATABASE_URL ausente: o banco é tratado como indisponível.
    saudavel = false;
  }
  return Response.json(
    { status: saudavel ? 'ok' : 'indisponivel' },
    { status: saudavel ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
