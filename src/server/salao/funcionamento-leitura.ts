import { repos } from '@/server/repos';
import { lerFuncionamentoPublico } from '@/server/repos/publico';
import type { ContextoEscopado, PublicoContext } from '@/server/tenant/context';
import { montarSemana } from '@/server/semana/montagem';

import type { Funcionamento } from './funcionamento-tipos';

/**
 * Horário de funcionamento do salão para uso interno (D-020 RN-17, A-6; E3.1, análoga a lerSemana), SEM
 * checagem de papel. Aceita TenantContext, SistemaContext ou PublicoContext e despacha por `ctx.tipo`:
 * 'publico' → lerFuncionamentoPublico (exigirPublico); qualquer outro → repos().funcionamento.ler
 * (exigirEscopo, que recusa AdminContext e objetos forjados com Error). Só lê o salão do contexto, num
 * único comando (A-5).
 *
 * Obrigações de quem consome (E3.1/E3.2/E3.3/E3.4):
 * - `definido: false` → o funcionamento NÃO limita a disponibilidade (segue só a jornada).
 * - `definido: true` → 7 dias (índice = diaSemana, 0 = domingo); dia sem intervalos = fechado;
 *   intervalos canônicos [início, fim) ordenados, com as pausas.
 * - Os minutos são hora LOCAL de parede no `salao.fuso`, nunca UTC; a conversão em instantes, inclusive
 *   horário de verão, é feita com src/server/tempo/fuso.ts, como a jornada.
 */
export async function lerFuncionamento(ctx: ContextoEscopado | PublicoContext): Promise<Funcionamento> {
  const dto = ctx.tipo === 'publico' ? await lerFuncionamentoPublico(ctx) : await repos().funcionamento.ler(ctx);
  return dto.definido ? { definido: true, semana: montarSemana(dto.linhas) } : { definido: false };
}
