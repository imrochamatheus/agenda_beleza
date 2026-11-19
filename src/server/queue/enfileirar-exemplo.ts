import { ErroDeAmbiente } from '@/server/env';

import { type ClienteFila, criarClienteFila } from './client';
import { ErroFilaIndisponivel } from './erros';
import { FILA } from './filas';

// Lógica do script de verificação manual (D-008 §3.9, D-4): enfileira um job `exemplo` que espera
// `esperaMs`. Uso: `npm run fila:exemplo -- 20000` ou, no compose,
// `docker compose exec worker node dist/scripts/enfileirar-exemplo.js 20000`.

export interface SaidaScript {
  log(mensagem: string): void;
  error(mensagem: string): void;
}

const USO = 'uso: enfileirar-exemplo [esperaMs] (inteiro de 0 a 60000; padrão 0)';

export async function executarEnfileirarExemplo(
  args: readonly string[],
  fonte: Record<string, string | undefined>,
  saida: SaidaScript,
  cliente: ClienteFila = criarClienteFila(fonte),
): Promise<0 | 1> {
  try {
    const [bruto] = args;
    const esperaMs = bruto === undefined ? 0 : /^\d+$/.test(bruto) ? Number(bruto) : NaN;
    if (!Number.isInteger(esperaMs) || esperaMs > 60_000 || args.length > 1) {
      saida.error(`enfileirar-exemplo: argumento inválido; ${USO}`);
      return 1;
    }
    const r = await cliente.enfileirar(FILA.exemplo, { esperaMs });
    // `exemplo` é standard: sem chave, todo enfileirar cria um job.
    if (!r.criado) throw new Error('job não criado');
    saida.log(JSON.stringify({ evento: 'fila.enfileirado', fila: FILA.exemplo, id: r.id, esperaMs }));
    return 0;
  } catch (erro) {
    if (erro instanceof ErroFilaIndisponivel || erro instanceof ErroDeAmbiente) {
      // Mensagens já sem credenciais (só nomes de variáveis ou o motivo).
      saida.error(`enfileirar-exemplo: ${erro.message}`);
      return 1;
    }
    throw erro;
  } finally {
    await cliente.encerrar();
  }
}
