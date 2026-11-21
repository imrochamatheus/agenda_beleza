// Criação de reserva (D-025 §3.5, E3.2): revalida no servidor, grava tudo ou nada, traduz o 23P01 da
// exclusion constraint em "horário indisponível" e é idempotente por `chaveRequisicao`. Sem 'use server'
// e sem next/*: a E3.4 (equipe) e a E4.1/E4.2 (público) o chamam. Nenhuma `*.acao.ts` aqui.
//
// ORDEM DE TRAVAS (D-025 §6.1), tudo numa só `emTransacao` READ COMMITTED: salão FOR SHARE → profissional
// FOR SHARE → serviços FOR SHARE por id → cliente (upsert) → reserva → itens → consentimento → mensagem.
// Todo desfecho que não é `criada` é uma exceção-sentinela (`DesfazerReserva`) lançada de dentro da
// transação, que a desfaz inteira, e capturada FORA dela (RN-13). O 23P01 também é traduzido fora.
import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import { registrarMensagem } from '@/server/mensagens/registrar';
import type { ResultadoRegistro } from '@/server/mensagens/tipos';
import { registrarConsentimentoDaReserva } from '@/server/consentimento/servico';
import { upsertCliente } from '@/server/clientes/servico';
import { consultarDisponibilidade } from '@/server/disponibilidade/servico';
import { repos } from '@/server/repos';
import type { ReservaDTO } from '@/server/repos/tipos';
import { emTransacao } from '@/server/repos/transacao';
import { exigirEscopo } from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';
import { politicaDeOperacao } from '@/server/tenant/politica';
import { partesLocais } from '@/server/tempo/fuso';
import { validarConsentimentoDaReserva } from '@/server/consentimento/validacao';

import { ehConflitoDeSobreposicao } from './erros-banco';
import { conferirCompativel, montarItens, paraReservaCriada } from './montar-itens';
import { MENSAGENS_RESERVA } from './tipos';
import type {
  CausaIndisponibilidade,
  DependenciasCriarReserva,
  EntradaCriarReserva,
  PoliticaDeReserva,
  ReservaCriada,
  ResultadoCriarReserva,
} from './tipos';
import { validarEntradaReserva } from './validacao';

/**
 * Política padrão (A-9): equipe passa por `politicaDeOperacao`; o público (sistema) hoje sempre pode.
 * A E6.4 troca esta função pela decisão por estado do salão.
 */
export const politicaPadraoDeReserva: PoliticaDeReserva = (ctx, capacidade) =>
  ctx.tipo === 'tenant' ? politicaDeOperacao(ctx, capacidade) : { permitido: true };

type SaidaDeNegocio = Extract<
  ResultadoCriarReserva,
  {
    resultado:
      | 'horario_indisponivel'
      | 'servico_indisponivel'
      | 'profissional_indisponivel'
      | 'invalido'
      | 'recusado';
  }
>;
type SaidaInterna = SaidaDeNegocio | { resultado: 'chave_repetida' };

/** Sentinela (A-7): desfaz a transação e carrega o desfecho. Não é exportada do módulo. */
class DesfazerReserva extends Error {
  constructor(readonly saida: SaidaInterna) {
    super('reserva desfeita');
    this.name = 'DesfazerReserva';
  }
}

function sair(saida: SaidaInterna): never {
  throw new DesfazerReserva(saida);
}

type Criada = { reserva: ReservaCriada; registro: ResultadoRegistro };

function registrar(dados: Record<string, unknown>): void {
  // RN-21: só ids e enumerados; nunca nome, telefone, chave, aceites nem mensagem do banco.
  console.info(JSON.stringify({ evento: 'reserva.criar', ...dados }));
}

export async function criarReserva(
  ctx: ContextoEscopado,
  entrada: EntradaCriarReserva,
  deps: DependenciasCriarReserva = {},
): Promise<ResultadoCriarReserva> {
  // --- Fase pura (A-14): nada daqui toca o banco.
  const v = validarEntradaReserva(entrada, ctx);
  const salaoId = exigirEscopo(ctx);
  const base = {
    salaoId,
    origem: ctx.tipo === 'tenant' ? 'equipe' : 'publico',
    modo: entrada.modo ?? 'normal',
  };
  const concluir = <T extends ResultadoCriarReserva>(r: T, extra: Record<string, unknown> = {}): T => {
    registrar({
      ...base,
      profissionalId: v.ok && !v.idsMalformados.profissional ? v.profissionalId : null,
      resultado: r.resultado,
      causa: r.resultado === 'horario_indisponivel' ? r.causa : null,
      repetida: r.resultado === 'repetida',
      ...extra,
    });
    return r;
  };

  if (!v.ok) {
    return concluir({ resultado: 'invalido', erros: v.erros });
  }

  const aceites = validarConsentimentoDaReserva(entrada.aceites);
  if (!aceites.ok) {
    return concluir({ resultado: 'consentimento_ausente', erros: aceites.erros });
  }

  const decisao = await (deps.politica ?? politicaPadraoDeReserva)(ctx, 'agendar');
  if (!decisao.permitido) {
    if (ctx.tipo === 'tenant') throw new AcessoNegado(decisao.motivo);
    return concluir({ resultado: 'salao_indisponivel' });
  }

  if (v.idsMalformados.profissional) return concluir({ resultado: 'profissional_indisponivel' });
  if (v.idsMalformados.servicos) return concluir({ resultado: 'servico_indisponivel' });

  const pedido = { profissionalId: v.profissionalId, inicio: v.inicio, servicoIds: v.servicoIds };

  /** RN-6/RN-7: a reserva já gravada com a chave é a mesma requisição ou uma chave reutilizada. */
  const porChave = async (): Promise<ResultadoCriarReserva | null> => {
    if (v.chave === null) return null;
    const existente: ReservaDTO | null = await repos().reservas.buscarPorChave(ctx, v.chave);
    if (existente === null) return null;
    return conferirCompativel(existente, pedido)
      ? { resultado: 'repetida', reserva: paraReservaCriada(existente) }
      : { resultado: 'chave_reutilizada' };
  };

  const previa = await porChave();
  if (previa !== null) {
    return concluir(previa, previa.resultado === 'repetida' ? { reservaId: previa.reserva.id } : {});
  }

  // --- Transação única.
  let saida: SaidaInterna | { resultado: 'criada'; criada: Criada };
  try {
    const criada = await emTransacao(async (r): Promise<Criada> => {
      const { fuso, intervaloMin } = await r.saloes.travarParaLeitura(ctx);

      const prof = await r.profissionais.travarParaReserva(ctx, v.profissionalId);
      if (prof === null || !prof.ativo) return sair({ resultado: 'profissional_indisponivel' });

      const linhas = await r.servicos.travarParaReserva(ctx, v.servicoIds, v.profissionalId);
      const porId = new Map(linhas.map((l) => [l.id.toLowerCase(), l]));
      const escolhidos = v.servicoIds.map((id) => porId.get(id));
      if (escolhidos.some((s) => s === undefined || !s.ativo)) {
        return sair({ resultado: 'servico_indisponivel' });
      }
      const servicos = escolhidos as NonNullable<(typeof escolhidos)[number]>[];
      if (servicos.some((s) => !s.vinculado)) return sair({ resultado: 'profissional_indisponivel' });

      if (v.modo === 'normal') {
        const dia = partesLocais(v.inicio, fuso).data;
        let consulta;
        try {
          consulta = await consultarDisponibilidade(
            ctx,
            { servicoIds: v.servicoIds, profissionalId: v.profissionalId, de: dia, ate: dia, agora: entrada.agora },
            r.disponibilidade,
          );
        } catch (e) {
          if (e instanceof NaoEncontrado) return sair({ resultado: 'profissional_indisponivel' });
          throw e;
        }
        if (consulta.resultado === 'servico_indisponivel') return sair({ resultado: 'servico_indisponivel' });
        if (consulta.resultado === 'entrada_invalida') {
          return sair({ resultado: 'invalido', erros: { inicio: MENSAGENS_RESERVA.inicio } });
        }
        const oferecido = consulta.profissionais
          .find((p) => p.profissionalId.toLowerCase() === v.profissionalId)
          ?.dias.some((d) => d.horarios.some((h) => h.inicio.getTime() === v.inicio.getTime()));
        if (!oferecido) {
          return sair({ resultado: 'horario_indisponivel', causa: 'revalidacao' });
        }
        await deps.aposRevalidar?.();
      } else if (v.inicio.getTime() < entrada.agora.getTime()) {
        return sair({ resultado: 'invalido', erros: { inicio: MENSAGENS_RESERVA.inicioPassado } });
      }

      const montado = montarItens(
        v.inicio,
        servicos.map((s) => ({ servicoId: s.id, precoCentavos: s.precoCentavos, duracaoMin: s.duracaoMin })),
        intervaloMin,
      );
      if (!montado.ok) throw new Error(`itens da reserva inválidos: ${montado.motivo}`);

      const cliente = await upsertCliente(ctx, { nome: entrada.cliente.nome, telefone: entrada.cliente.telefone }, r);
      if (cliente.resultado !== 'ok') throw new Error('upsert da cliente recusou uma entrada já validada');
      const clienteId = cliente.cliente.id;

      if (deps.antesDaReserva) {
        const liberado = await deps.antesDaReserva(ctx, r, { clienteId, inicio: v.inicio });
        if (!liberado.permitido) return sair({ resultado: 'recusado', motivo: liberado.motivo });
      }

      const origem = ctx.tipo === 'tenant' ? 'equipe' : 'publico';
      const encaixe = v.modo === 'encaixe';
      const inserida = await r.reservas.criar(ctx, {
        profissionalId: v.profissionalId,
        clienteId,
        inicio: v.inicio,
        fim: montado.fim,
        ocupadoAte: montado.ocupadoAte,
        origem,
        encaixe,
        chaveRequisicao: v.chave,
      });
      if (!inserida.criada) return sair({ resultado: 'chave_repetida' });
      await r.reservas.criarItens(
        ctx,
        inserida.id,
        montado.itens.map(({ servicoId, ordem, precoCentavos, duracaoMin }) => ({ servicoId, ordem, precoCentavos, duracaoMin })),
      );

      const consentimento = await registrarConsentimentoDaReserva(
        ctx,
        { clienteId, aceites: entrada.aceites, origem, agora: entrada.agora },
        r,
      );
      if (!consentimento.ok) throw new Error('consentimento recusou aceites já validados');

      const registro = await registrarMensagem(ctx, { reservaId: inserida.id, tipo: 'confirmacao' }, entrada.agora, r);

      return {
        registro,
        reserva: {
          id: inserida.id,
          profissionalId: v.profissionalId,
          clienteId,
          inicio: v.inicio,
          fim: montado.fim,
          ocupadoAte: montado.ocupadoAte,
          status: 'confirmado',
          origem,
          encaixe,
          revisao: 0,
          itens: montado.itens,
        },
      };
    });
    saida = { resultado: 'criada', criada };
  } catch (e) {
    if (e instanceof DesfazerReserva) {
      saida = e.saida;
    } else if (ehConflitoDeSobreposicao(e)) {
      saida = { resultado: 'horario_indisponivel', causa: '23P01' as CausaIndisponibilidade };
    } else {
      throw e;
    }
  }

  if (saida.resultado === 'criada') {
    const { reserva, registro } = saida.criada;
    // Depois do commit (RN-5): a fila nunca lança nem altera a reserva.
    await enfileirarMensagens([registro], { enfileirar: deps.enfileirar });
    return concluir(
      {
        resultado: 'criada',
        reserva,
        confirmacao: {
          mensagemId: registro.mensagemId,
          estado: registro.estado === 'pendente' ? 'pendente' : 'nao_enviada',
        },
      },
      { reservaId: reserva.id },
    );
  }

  // RN-6 (c): qualquer indisponibilidade ou a chave repetida com chave relê por chave, fora da transação.
  if (saida.resultado === 'horario_indisponivel' || saida.resultado === 'chave_repetida') {
    const relida = await porChave();
    if (relida !== null) {
      return concluir(relida, relida.resultado === 'repetida' ? { reservaId: relida.reserva.id } : {});
    }
    if (saida.resultado === 'chave_repetida') {
      throw new Error('chave de requisição repetida sem reserva correspondente');
    }
  }
  return concluir(saida as SaidaDeNegocio);
}
