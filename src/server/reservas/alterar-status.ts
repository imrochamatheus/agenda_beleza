// Núcleo comum de cancelar e marcar status (D-030 RN-3, RN-6, RN-8, RN-9). Uma transação READ COMMITTED:
// salão FOR SHARE → profissional FOR NO KEY UPDATE → cliente FOR KEY SHARE → reserva FOR UPDATE → UPDATE do
// status → mensagem (outbox, sempre por último). `enfileirarMensagens` só depois do commit.
import { exigirPermissao } from '@/server/auth/permissoes';
import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import { registrarMensagem } from '@/server/mensagens/registrar';
import type { ResultadoRegistro } from '@/server/mensagens/tipos';
import type { StatusReserva } from '@/server/repos/tipos';
import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';

import { aplicarPolitica, DesfazerAlteracao, localizarReserva, registrarEvento, sair } from './alteracao-comum';
import { decidirTransicao } from './status';
import type { DependenciasAlteracao, ResultadoStatus } from './tipos-alteracao';

type Recusado = Extract<ResultadoStatus, { resultado: 'recusado' }>;

export async function alterarStatus(
  ctx: TenantContext,
  { reservaId, destino, permitidos, operacao }: { reservaId: unknown; destino: unknown; permitidos: readonly StatusReserva[]; operacao: 'cancelar' | 'marcar_status' },
  agora: Date,
  deps: DependenciasAlteracao,
): Promise<ResultadoStatus> {
  const previa = await localizarReserva(ctx, reservaId);
  await aplicarPolitica(ctx, 'cancelar', deps, agora);
  const para = permitidos.find((p) => p === destino);
  if (para === undefined) {
    // Destino fora do que a operação aceita: recusado sem gravar (a máquina também recusaria).
    registrarEvento({ operacao, salaoId: ctx.salaoId, reservaId: previa.id, resultado: 'recusado', motivo: 'transicao_invalida' });
    return { resultado: 'recusado', motivo: 'transicao_invalida' };
  }

  let saida: Recusado | { resultado: 'ok'; revisao: number; registro: ResultadoRegistro | null };
  try {
    saida = await emTransacao(async (r) => {
      await r.saloes.travarParaLeitura(ctx);
      await r.profissionais.travarParaReserva(ctx, previa.profissionalId);
      await deps.aposTravas?.();
      await r.reservasAlteracao.travarCliente(ctx, previa.clienteId);
      const atual = await r.reservasAlteracao.travarParaAlterar(ctx, previa.id);
      exigirPermissao(ctx, 'reserva.alterar', { profissionalId: atual.profissionalId });

      const d = decidirTransicao({ de: atual.status, para, inicio: atual.inicio, fim: atual.fim, agora });
      if (!d.ok) return sair<Recusado>({ resultado: 'recusado', motivo: d.motivo });

      await r.reservasAlteracao.atualizarStatus(ctx, atual.id, { de: atual.status, para, agora });

      let registro: ResultadoRegistro | null = null;
      if (para === 'cancelado') {
        registro = await registrarMensagem(ctx, { reservaId: atual.id, tipo: 'cancelamento' }, agora, r);
      } else if (para === 'concluido') {
        // A volta (nao_compareceu → concluido) cai na chave única: não cria nem reenfileira (CA-R2).
        registro = await registrarMensagem(ctx, { reservaId: atual.id, tipo: 'convite_avaliacao' }, agora, r);
      } else if (atual.status === 'concluido') {
        // concluido → nao_compareceu: só o convite ainda `pendente` é substituído; o `enviado` não muda.
        await r.mensagens.substituirPendentes(ctx, { reservaId: atual.id, tipos: ['convite_avaliacao'], revisaoMenorQue: null }, agora);
      }
      return { resultado: 'ok' as const, revisao: atual.revisao, registro };
    });
  } catch (e) {
    if (e instanceof DesfazerAlteracao) saida = e.saida as Recusado;
    else throw e;
  }

  const base = { operacao, salaoId: ctx.salaoId, reservaId: previa.id, para };
  if (saida.resultado === 'recusado') {
    registrarEvento({ ...base, resultado: 'recusado', motivo: saida.motivo });
    return saida;
  }
  if (saida.registro !== null) await enfileirarMensagens([saida.registro], { enfileirar: deps.enfileirar });
  registrarEvento({ ...base, resultado: 'atualizada' });
  return {
    resultado: 'atualizada',
    status: para,
    revisao: saida.revisao,
    mensagem: saida.registro === null ? null : { mensagemId: saida.registro.mensagemId, estado: saida.registro.estado },
  };
}
