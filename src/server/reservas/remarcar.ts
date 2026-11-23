// Remarcar UM item (D-030 RN-4/RN-5; D-050 §3.6, A-8, RN-22, RN-23, RN-28): UPDATE do item (nunca apagar e
// reinserir) numa só transação READ COMMITTED. ORDEM DE TRAVAS (design §4.6): salão FOR SHARE →
// profissionais {atual do item, alvo} FOR NO KEY UPDATE em ordem de id → serviço(s) FOR SHARE + vínculo com
// o alvo → cliente FOR KEY SHARE → reserva FOR UPDATE (última) → itens → mensagem. Os outros itens não mudam.
// Regras checadas ANTES de qualquer UPDATE (dba.md M-6): item `confirmado`, início não passado, data (RN-22),
// serviço não repetido na reserva inclusive em item cancelado (M-5; o 23505 nunca é capturado), RN-8/RN-9
// contra os outros itens (`conferirItens`) e encaixe (lote de 1). Desfechos não-`atualizada` são sentinelas;
// o 23P01 (SQLSTATE + nome) é traduzido FORA da transação. Equipe sem grade/antecedência/janela (D-030).
import { ehAceite } from '@/server/consentimento/validacao';
import { exigirPermissao } from '@/server/auth/permissoes';
import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import type { ResultadoRegistro } from '@/server/mensagens/tipos';
import { ehUuid } from '@/server/repos/ids';
import { chaveVinculo } from '@/server/repos/servico';
import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';
import { compararDatas, instanteDeHoraLocal, partesLocais } from '@/server/tempo/fuso';

import { aplicarPolitica, DesfazerAlteracao, fecharAlteracao, itemTravado, localizarItem, registrarEvento, sair } from './alteracao-comum';
import { criarDecisorDeEncaixe } from './decisor-encaixe';
import { ehConflitoDeSobreposicao } from './erros-banco';
import { conferirItens } from './itens';
import { lerData, lerHora } from './reserva-equipe';
import { podeRemarcar } from './status';
import { MENSAGENS_ALTERACAO } from './tipos-alteracao';
import type { DependenciasAlteracao, EntradaRemarcarItem, ResultadoRemarcarItem } from './tipos-alteracao';

type Saida = Exclude<ResultadoRemarcarItem, { resultado: 'atualizada' }>;
type Ok = { resultado: 'ok'; revisao: number; encaixe: boolean; registro: ResultadoRegistro };

const MIN_MS = 60_000;

/** `undefined`, `null` ou texto vazio = "manter o atual"; texto = id (minúsculas); outro tipo = inválido. */
function lerOpcional(v: unknown): { ok: true; valor: string | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, valor: null };
  if (typeof v !== 'string') return { ok: false };
  const t = v.trim().toLowerCase();
  return { ok: true, valor: t === '' ? null : t };
}

export async function remarcarItem(
  ctx: TenantContext,
  e: EntradaRemarcarItem,
  agora: Date,
  deps: DependenciasAlteracao = {},
): Promise<ResultadoRemarcarItem> {
  const previa = await localizarItem(ctx, e.reservaId, e.itemId);
  const servicoLido = lerOpcional(e.servicoId);
  const profissionalLido = lerOpcional(e.profissionalId);
  const atualDoItem = previa.item.profissionalId.toLowerCase();
  const alvoId = profissionalLido.ok && profissionalLido.valor !== null ? profissionalLido.valor : atualDoItem;
  // RN-25: o profissional não move o próprio item para outra pessoa; o alvo também passa pela matriz (403).
  exigirPermissao(ctx, 'reserva.alterar', { profissionalId: alvoId });
  await aplicarPolitica(ctx, 'agendar', deps, agora);

  const base = { operacao: 'remarcar_item', salaoId: ctx.salaoId, reservaId: previa.id, itemId: previa.item.id };
  const concluir = (r: ResultadoRemarcarItem, extra: Record<string, unknown> = {}): ResultadoRemarcarItem => {
    registrarEvento({ ...base, resultado: r.resultado, ...(r.resultado === 'recusado' && { motivo: r.motivo }), ...extra });
    return r;
  };

  // --- Fase pura: nada daqui toca o banco.
  const dataVazia = e.data === undefined || e.data === null || (typeof e.data === 'string' && e.data.trim() === '');
  const dataInformada = dataVazia ? null : lerData(e.data);
  const minutos = lerHora(e.hora);
  const erros: Record<string, string> = {};
  if (minutos === null) erros.inicio = MENSAGENS_ALTERACAO.inicio;
  if (!dataVazia && dataInformada === null) erros.data = MENSAGENS_ALTERACAO.inicio;
  if (!servicoLido.ok) erros.servico = MENSAGENS_ALTERACAO.servico;
  if (Object.keys(erros).length > 0) return concluir({ resultado: 'invalido', erros });
  if (!profissionalLido.ok || !ehUuid(alvoId)) return concluir({ resultado: 'profissional_indisponivel' });
  const servicoPedido = servicoLido.ok ? servicoLido.valor : null;
  if (servicoPedido !== null && !ehUuid(servicoPedido)) return concluir({ resultado: 'servico_indisponivel' });
  const servicoDaPrevia = previa.item.servicoId.toLowerCase();
  const alvoServico = servicoPedido ?? servicoDaPrevia;
  const confirmou = ehAceite(e.confirmarEncaixe);

  let saida: Saida | Ok;
  try {
    saida = await emTransacao(async (r) => {
      const { intervaloMin, fuso } = await r.saloes.travarParaLeitura(ctx);

      // Profissionais {atual do item, alvo}, sem repetição, em ordem de id (A-10/Q12).
      const travados = await r.profissionais.travarVariosParaReserva(ctx, [atualDoItem, alvoId]);
      const alvo = travados.get(alvoId);
      // DEF-1: "manter" (vazio) um profissional inativo nunca move o item em silêncio: é erro de campo.
      if (alvo !== null && alvo !== undefined && !alvo.ativo && profissionalLido.ok && profissionalLido.valor === null) {
        return sair<Saida>({ resultado: 'invalido', erros: { profissional: MENSAGENS_ALTERACAO.escolhaProfissional } });
      }
      if (alvo === null || alvo === undefined || !alvo.ativo) return sair<Saida>({ resultado: 'profissional_indisponivel' });

      // Serviço(s) {atual da prévia, pedido} FOR SHARE em ordem de id + vínculo de cada um com o alvo.
      const ids = [...new Set([servicoDaPrevia, alvoServico])];
      const servicos = await r.servicos.travarParaItens(ctx, ids, ids.map((servicoId) => ({ servicoId, profissionalId: alvoId })));
      await deps.aposTravas?.();

      await r.reservasAlteracao.travarCliente(ctx, previa.clienteId);
      const atual = await r.reservasAlteracao.travarParaAlterar(ctx, previa.id);
      const itens = await r.reservasAlteracao.lerItens(ctx, atual.id);
      // Outra operação pode ter mudado o item entre a prévia e a trava: reconfere item e permissão.
      const item = itemTravado(ctx, itens, previa.item.id);
      if (item.status === 'cancelado') return sair<Saida>({ resultado: 'recusado', motivo: 'item_final' });
      if (!podeRemarcar(item.status)) return sair<Saida>({ resultado: 'recusado', motivo: 'transicao_invalida' });
      const servicoAtual = item.servicoId.toLowerCase();
      // Sem serviço/profissional pedido, "manter" vale para o que a prévia viu; se mudou no meio, recusa.
      if (servicoAtual !== servicoDaPrevia || (profissionalLido.ok && profissionalLido.valor === null && item.profissionalId.toLowerCase() !== atualDoItem)) {
        return sair<Saida>({ resultado: 'recusado', motivo: 'transicao_invalida' });
      }

      const dataAtual = partesLocais(item.inicio, fuso).data;
      const data = dataInformada ?? dataAtual;
      const inicio = instanteDeHoraLocal(data, minutos!, fuso);
      if (inicio.getTime() < agora.getTime()) {
        return sair<Saida>({ resultado: 'invalido', erros: { inicio: MENSAGENS_ALTERACAO.inicioPassado } });
      }
      // RN-22: a data só muda se o item é o único não cancelado da reserva.
      const outrosAtivos = itens.filter((i) => i.id !== item.id && i.status !== 'cancelado');
      if (compararDatas(data, dataAtual) !== 0 && outrosAtivos.length > 0) {
        return sair<Saida>({ resultado: 'recusado', motivo: 'data_diferente' });
      }
      // M-5: o serviço novo não pode já existir na reserva, inclusive em item cancelado (a UNIQUE inclui cancelados).
      const trocaServico = alvoServico !== servicoAtual;
      if (trocaServico && itens.some((i) => i.id !== item.id && i.servicoId.toLowerCase() === alvoServico)) {
        return sair<Saida>({ resultado: 'recusado', motivo: 'servico_repetido' });
      }
      const servico = servicos.find((s) => s.id.toLowerCase() === alvoServico);
      if (servico === undefined || (trocaServico && !servico.ativo)) return sair<Saida>({ resultado: 'servico_indisponivel' });
      if (!servicos.vinculados.has(chaveVinculo(alvoServico, alvoId))) return sair<Saida>({ resultado: 'profissional_indisponivel' });

      if (!trocaServico && alvoId === item.profissionalId.toLowerCase() && inicio.getTime() === item.inicio.getTime()) {
        return sair<Saida>({ resultado: 'recusado', motivo: 'sem_alteracao' });
      }

      // Snapshot novo só se o serviço mudar (RN-22); o intervalo do salão é o atual.
      const precoCentavos = trocaServico ? servico.precoCentavos : item.precoCentavos;
      const duracaoMin = trocaServico ? servico.duracaoMin : item.duracaoMin;
      const fim = new Date(inicio.getTime() + duracaoMin * MIN_MS);
      const ocupadoAte = new Date(fim.getTime() + intervaloMin * MIN_MS);

      // RN-8/RN-9 contra os outros itens, ANTES do UPDATE (M-6: senão a exclusion daria um 23P01 enganoso).
      const depois = itens.map((i) => (i.id === item.id ? { ...i, profissionalId: alvoId, inicio, fim, ocupadoAte } : i));
      const conferencia = conferirItens(depois, fuso);
      if (!conferencia.ok) {
        return sair<Saida>(
          conferencia.motivo === 'data_diferente'
            ? { resultado: 'recusado', motivo: 'data_diferente' }
            : { resultado: 'horario_indisponivel', causa: 'entre_itens' },
        );
      }

      const decisao = await criarDecisorDeEncaixe(confirmou)(ctx, r, { fuso, itens: [{ inicio, fim, profissionalId: alvoId }] });
      if ('motivos' in decisao) return sair<Saida>({ resultado: 'encaixe_requer_confirmacao', motivos: decisao.motivos[0].motivos });
      const encaixe = decisao.encaixes[0];

      // RN-28: a revisão sobe ANTES de registrar a mensagem; o item guarda a revisão da sua última mudança.
      const revisao = atual.revisao + 1;
      await r.reservasAlteracao.atualizarItem(ctx, atual.id, item.id, {
        servicoId: alvoServico,
        profissionalId: alvoId,
        inicio,
        fim,
        ocupadoAte,
        precoCentavos,
        duracaoMin,
        encaixe,
        revisao,
        agora,
      });
      const fecho = await fecharAlteracao(ctx, r, atual, { revisao, eventos: [{ tipo: 'remarcacao', reservaItemId: item.id }], agora });
      return { resultado: 'ok' as const, revisao, encaixe, registro: fecho.registros[0] };
    });
  } catch (err) {
    if (err instanceof DesfazerAlteracao) saida = err.saida as Saida;
    else if (ehConflitoDeSobreposicao(err)) saida = { resultado: 'horario_indisponivel', causa: '23P01' };
    else throw err;
  }

  if (saida.resultado !== 'ok') return concluir(saida);
  // Depois do commit: a fila nunca lança nem altera a reserva (RN-32).
  await enfileirarMensagens([saida.registro], { enfileirar: deps.enfileirar });
  return concluir(
    {
      resultado: 'atualizada',
      itemId: previa.item.id,
      revisao: saida.revisao,
      encaixe: saida.encaixe,
      mensagem: { mensagemId: saida.registro.mensagemId, estado: saida.registro.estado },
    },
    { revisao: saida.revisao, encaixe: saida.encaixe },
  );
}
