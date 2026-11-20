import { exigirPermissao, pode } from '@/server/auth/permissoes';
import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { diferenca, montarSemana } from './semana';
import type { JornadaVisao, ResultadoSalvarJornada } from './tipos';
import { validarSemana } from './validacao';

// Serviço de domínio da jornada semanal (D-015 §3.5; RN-1..RN-13). Sem next/*: a ação
// (jornadas.acao.ts) e a página o chamam. Só usa o salão do contexto. A gravação segue a ordem
// canônica de travas (repos/jornada.ts): profissional FOR NO KEY UPDATE OF pj → jornada.

/** Log estruturado de uma linha, só ids e contagens (sem nomes). */
function registrar(evento: string, dados: Record<string, unknown>): void {
  console.info(JSON.stringify({ evento, ...dados }));
}

/**
 * Jornada para a página (RN-1, RN-8, RN-13). Ordem: operação → 404 (outro salão, inexistente ou
 * malformado; também para o profissional, CA-12) → alvo (outro profissional do mesmo salão → 403).
 */
export async function obter(ctx: TenantContext, profissionalId: unknown): Promise<JornadaVisao> {
  exigirPermissao(ctx, 'jornada.ver');
  if (typeof profissionalId !== 'string') {
    throw new NaoEncontrado();
  }
  const r = repos();
  const profissional = await r.jornadas.buscarProfissional(ctx, profissionalId);
  exigirPermissao(ctx, 'jornada.ver', { profissionalId: profissional.id });
  const semana = montarSemana(await r.jornadas.listarDoProfissional(ctx, profissional.id));
  return {
    profissional,
    semana,
    semIntervalos: semana.every((d) => d.intervalos.length === 0),
    editavel: pode(ctx.papel, 'jornada.editar') === 'salao',
  };
}

/**
 * Substitui a semana inteira (RN-6) numa transação: validação pura → trava do profissional (404 se
 * não é do salão; inativo aceito, RN-13) → diferença (D-13: preserva ids, sem mudança não grava).
 * Não toca reservas nem enfileira mensagens (RN-9).
 */
export async function salvar(ctx: TenantContext, e: unknown): Promise<ResultadoSalvarJornada> {
  exigirPermissao(ctx, 'jornada.editar');
  const v = validarSemana(e);
  if (!v.ok) {
    return { resultado: 'invalido', erros: v.erros };
  }
  const { profissionalId: id, intervalos } = v;
  const r = await emTransacao(async (t) => {
    await t.jornadas.travarProfissional(ctx, id);
    const atuais = await t.jornadas.listarDoProfissional(ctx, id);
    return t.jornadas.aplicarDiferenca(ctx, id, diferenca(atuais, intervalos));
  });
  registrar('jornada.salva', {
    salaoId: ctx.salaoId,
    profissionalId: id,
    inseridos: r.inseridos,
    removidos: r.removidos,
    intervalos: intervalos.length,
  });
  return { resultado: 'salvo', semana: montarSemana(intervalos), inseridos: r.inseridos, removidos: r.removidos };
}
