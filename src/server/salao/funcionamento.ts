import { exigirPermissao } from '@/server/auth/permissoes';
import { emTransacao } from '@/server/repos/transacao';
import { diferenca, montarSemana } from '@/server/semana/montagem';
import type { TenantContext } from '@/server/tenant/context';

import { lerFuncionamento } from './funcionamento-leitura';
import type { Funcionamento, ResultadoSalvarFuncionamento } from './funcionamento-tipos';
import { validarFuncionamento } from './funcionamento-validacao';

// Serviço do horário de funcionamento do salão (D-020 §3.6; RN-11..RN-16). Sem next/*. Só o salão do
// contexto; cada função começa por exigirPermissao. A gravação trava a linha de `salao`
// (FOR NO KEY UPDATE, A-4), lista as linhas em comando separado, aplica a diferença e só escreve o
// estado se ele mudou: gravar o mesmo estado e a mesma semana não escreve nada (CA-4). Não toca reservas,
// jornadas, bloqueios nem mensagens, e não enfileira nada (RN-15).

/** Log estruturado de uma linha, só ids e contagens. */
function registrar(evento: string, dados: Record<string, unknown>): void {
  console.info(JSON.stringify({ evento, ...dados }));
}

/** Funcionamento gravado (página). */
export async function obterFuncionamento(ctx: TenantContext): Promise<Funcionamento> {
  exigirPermissao(ctx, 'salao.configurar');
  return lerFuncionamento(ctx);
}

/** RN-14: "informar" substitui a semana como diferença; "não informar" remove tudo. Inválido → nada (nem trava). */
export async function salvarFuncionamento(ctx: TenantContext, e: unknown): Promise<ResultadoSalvarFuncionamento> {
  exigirPermissao(ctx, 'salao.configurar');
  const v = validarFuncionamento(e);
  if (!v.ok) {
    return { resultado: 'invalido', erros: v.erros };
  }
  const definido = v.modo === 'informar';
  const desejados = v.modo === 'informar' ? v.intervalos : [];
  const r = await emTransacao(async (t) => {
    const atual = await t.funcionamento.travar(ctx);
    const linhas = await t.funcionamento.listar(ctx);
    const d = definido ? diferenca(linhas, desejados) : { remover: linhas.map((l) => l.id), inserir: [] };
    const aplicado = await t.funcionamento.aplicarDiferenca(ctx, d);
    const mudouEstado = atual.definido !== definido ? await t.funcionamento.definirEstado(ctx, definido) : false;
    return { ...aplicado, mudouEstado };
  });
  registrar('salao.funcionamento_salvo', { salaoId: ctx.salaoId, definido, ...r });
  return {
    resultado: 'salvo',
    funcionamento: definido ? { definido: true, semana: montarSemana(desejados) } : { definido: false },
    alterado: r.removidos + r.inseridos > 0 || r.mudouEstado,
  };
}
