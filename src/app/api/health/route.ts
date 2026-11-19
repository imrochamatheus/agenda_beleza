import { bancoDisponivel } from '@/server/repos/saude';

// Lê o banco a cada chamada; nunca é pré-renderizada no build.
export const dynamic = 'force-dynamic';

/** Público por definição (RN-10). O corpo 503 não traz mensagem, host nem credencial. */
export async function GET(): Promise<Response> {
  const saudavel = await bancoDisponivel();
  return Response.json(
    { status: saudavel ? 'ok' : 'indisponivel' },
    { status: saudavel ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
