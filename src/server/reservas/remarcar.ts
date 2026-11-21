// Remarcar reserva (D-030 RN-4/RN-5/RN-6): UPDATE da MESMA reserva numa só transação READ COMMITTED.
// ORDEM DE TRAVAS: salão FOR SHARE → profissional(is) FOR NO KEY UPDATE em ordem de id → serviços FOR SHARE
// → cliente FOR KEY SHARE → reserva FOR UPDATE (última) → itens → mensagem. Resultados que não são
// `atualizada` são sentinelas lançadas dentro e capturadas fora; o 23P01 (SQLSTATE + nome) também.
import { exigirPermissao } from '@/server/auth/permissoes';
import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import { registrarMensagem } from '@/server/mensagens/registrar';
import type { ResultadoRegistro } from '@/server/mensagens/tipos';
import { ehUuid } from '@/server/repos/ids';
import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';
import { instanteDeHoraLocal } from '@/server/tempo/fuso';
import { ehAceite } from '@/server/consentimento/validacao';
import { validarServicos } from '@/server/disponibilidade/validacao';
import { repos } from '@/server/repos';

import { aplicarPolitica, DesfazerAlteracao, localizarReserva, registrarEvento, sair } from './alteracao-comum';
import { ehConflitoDeSobreposicao } from './erros-banco';
import { montarItens } from './montar-itens';
import { criarDecisorDeEncaixe, lerData, lerHora } from './reserva-equipe';
import { podeRemarcar } from './status';
import { MENSAGENS_ALTERACAO } from './tipos-alteracao';
import type { DependenciasAlteracao, EntradaRemarcar, ResultadoRemarcar } from './tipos-alteracao';
import type { ReservaCriada } from './tipos';

type Saida = Exclude<ResultadoRemarcar, { resultado: 'atualizada' }>;

export async function remarcarReserva(
  ctx: TenantContext,
  e: EntradaRemarcar,
  agora: Date,
  deps: DependenciasAlteracao = {},
): Promise<ResultadoRemarcar> {
  const previa = await localizarReserva(ctx, e.reservaId);
  const alvoId = typeof e.profissionalId === 'string' ? e.profissionalId.trim().toLowerCase() : '';
  // Profissional não troca de profissional: o alvo também passa pela matriz (403).
  exigirPermissao(ctx, 'reserva.alterar', { profissionalId: alvoId });
  await aplicarPolitica(ctx, 'agendar', deps);

  const concluir = (r: ResultadoRemarcar, extra: Record<string, unknown> = {}): ResultadoRemarcar => {
    registrarEvento({ operacao: 'remarcar', salaoId: ctx.salaoId, reservaId: previa.id, resultado: r.resultado, ...extra });
    return r;
  };

  const data = lerData(e.data);
  const minutos = lerHora(e.hora);
  const brutos = Array.isArray(e.servicoIds) ? e.servicoIds : [];
  const textos = brutos.filter((s): s is string => typeof s === 'string').map((s) => s.trim().toLowerCase());
  const erros: Record<string, string> = {};
  if (data === null || minutos === null) erros.inicio = MENSAGENS_ALTERACAO.inicio;
  if (textos.length !== brutos.length || validarServicos(textos) !== null) erros.servicos = MENSAGENS_ALTERACAO.servicos;
  if (Object.keys(erros).length > 0) return concluir({ resultado: 'invalido', erros });
  if (!ehUuid(alvoId)) return concluir({ resultado: 'profissional_indisponivel' });
  if (!textos.every((s) => ehUuid(s))) return concluir({ resultado: 'servico_indisponivel' });

  const fuso = await repos().bloqueios.fusoDoSalao(ctx);
  const inicio = instanteDeHoraLocal(data!, minutos!, fuso);
  const confirmou = ehAceite(e.confirmarEncaixe);

  let saida: Saida | { resultado: 'atualizada'; reserva: ReservaCriada; registro: ResultadoRegistro };
  try {
    saida = await emTransacao(async (r) => {
      const { intervaloMin, fuso: fusoDaTx } = await r.saloes.travarParaLeitura(ctx);

      const ids = [...new Set([previa.profissionalId, alvoId])].sort();
      for (const id of ids) {
        const p = await r.profissionais.travarParaReserva(ctx, id);
        if (id === alvoId && (p === null || !p.ativo)) return sair<Saida>({ resultado: 'profissional_indisponivel' });
      }

      const linhas = await r.servicos.travarParaReserva(ctx, textos, alvoId);
      const porId = new Map(linhas.map((l) => [l.id.toLowerCase(), l]));
      const escolhidos = textos.map((id) => porId.get(id));
      if (escolhidos.some((s) => s === undefined)) return sair<Saida>({ resultado: 'servico_indisponivel' });
      await deps.aposTravas?.();

      await r.reservasAlteracao.travarCliente(ctx, previa.clienteId);
      const atual = await r.reservasAlteracao.travarParaAlterar(ctx, previa.id);
      // Outra remarcação pode ter trocado o profissional entre a leitura prévia e a trava: reconfere.
      exigirPermissao(ctx, 'reserva.alterar', { profissionalId: atual.profissionalId });
      if (!podeRemarcar(atual.status)) {
        return sair<Saida>({ resultado: 'recusado', motivo: atual.status === 'cancelado' ? 'reserva_final' : 'transicao_invalida' });
      }
      if (inicio.getTime() < agora.getTime()) {
        return sair<Saida>({ resultado: 'invalido', erros: { inicio: MENSAGENS_ALTERACAO.inicioPassado } });
      }

      const existentes = await r.reservasAlteracao.lerItens(ctx, atual.id);
      const pedidos = new Set(textos);
      const mantidos = existentes.filter((i) => pedidos.has(i.servicoId.toLowerCase()));
      const jaTinha = new Set(mantidos.map((i) => i.servicoId.toLowerCase()));
      const acrescentados = textos.filter((id) => !jaTinha.has(id));
      const novos = acrescentados.map((id) => porId.get(id)!);
      if (novos.some((s) => !s.ativo)) return sair<Saida>({ resultado: 'servico_indisponivel' });
      if (escolhidos.some((s) => !s!.vinculado)) return sair<Saida>({ resultado: 'profissional_indisponivel' });

      const montado = montarItens(
        inicio,
        [
          ...mantidos.map((i) => ({ servicoId: i.servicoId, precoCentavos: i.precoCentavos, duracaoMin: i.duracaoMin })),
          ...novos.map((s) => ({ servicoId: s.id, precoCentavos: s.precoCentavos, duracaoMin: s.duracaoMin })),
        ],
        intervaloMin,
      );
      if (!montado.ok) throw new Error(`itens da reserva inválidos: ${montado.motivo}`);

      const semMudancaDeItens = novos.length === 0 && mantidos.length === existentes.length;
      if (semMudancaDeItens && inicio.getTime() === atual.inicio.getTime() && alvoId === atual.profissionalId.toLowerCase()) {
        return sair<Saida>({ resultado: 'recusado', motivo: 'sem_alteracao' });
      }

      const decisao = await criarDecisorDeEncaixe(confirmou)(ctx, r, { inicio, fim: montado.fim, fuso: fusoDaTx, profissionalId: alvoId });
      if ('motivos' in decisao) return sair<Saida>({ resultado: 'encaixe_requer_confirmacao', motivos: decisao.motivos });

      await r.reservasAlteracao.atualizarPosicao(ctx, atual.id, {
        profissionalId: alvoId,
        inicio,
        fim: montado.fim,
        ocupadoAte: montado.ocupadoAte,
        encaixe: decisao.encaixe,
        agora,
      });
      const ordemAtual = new Map(existentes.map((i) => [i.servicoId.toLowerCase(), i.ordem]));
      await r.reservasAlteracao.substituirItens(ctx, atual.id, {
        remover: existentes.filter((i) => !pedidos.has(i.servicoId.toLowerCase())).map((i) => i.servicoId),
        reordenar: montado.itens
          .filter((i) => jaTinha.has(i.servicoId.toLowerCase()) && ordemAtual.get(i.servicoId.toLowerCase()) !== i.ordem)
          .map((i) => ({ servicoId: i.servicoId, ordem: i.ordem })),
        adicionar: montado.itens
          .filter((i) => !jaTinha.has(i.servicoId.toLowerCase()))
          .map(({ servicoId, ordem, precoCentavos, duracaoMin }) => ({ servicoId, ordem, precoCentavos, duracaoMin })),
      });

      const registro = await registrarMensagem(ctx, { reservaId: atual.id, tipo: 'remarcacao' }, agora, r);
      const revisao = atual.revisao + 1;
      return {
        resultado: 'atualizada' as const,
        registro,
        reserva: {
          id: atual.id,
          profissionalId: alvoId,
          clienteId: atual.clienteId,
          inicio,
          fim: montado.fim,
          ocupadoAte: montado.ocupadoAte,
          status: 'confirmado' as const,
          origem: atual.origem,
          encaixe: decisao.encaixe,
          revisao,
          itens: montado.itens,
        },
      };
    });
  } catch (err) {
    if (err instanceof DesfazerAlteracao) saida = err.saida as Saida;
    else if (ehConflitoDeSobreposicao(err)) saida = { resultado: 'horario_indisponivel', causa: '23P01' };
    else throw err;
  }

  if (saida.resultado !== 'atualizada') return concluir(saida);
  // Depois do commit: a fila nunca lança nem altera a reserva (CA-11, CA-R3).
  await enfileirarMensagens([saida.registro], { enfileirar: deps.enfileirar });
  return concluir(
    { resultado: 'atualizada', reserva: saida.reserva, mensagem: { mensagemId: saida.registro.mensagemId, estado: saida.registro.estado } },
    { revisao: saida.reserva.revisao, encaixe: saida.reserva.encaixe },
  );
}

