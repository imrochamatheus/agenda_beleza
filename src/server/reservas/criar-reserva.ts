// Criação de reserva (D-025 §3.5, E3.2; D-050 §3.5, E3.6): N itens, cada um com serviço, profissional e
// início próprios, na mesma data local do salão. Revalida no servidor, grava tudo ou nada, traduz o 23P01
// da exclusion `reserva_item_sem_sobreposicao` em "horário indisponível" e é idempotente por
// `chaveRequisicao`. Sem 'use server' e sem next/*: a equipe (E3.4) e o público (E4.1/E4.2) o chamam.
//
// ORDEM DE TRAVAS (D-050 §4.6, RN-13), tudo numa só `emTransacao` READ COMMITTED: salão FOR SHARE →
// profissionais distintos dos itens FOR NO KEY UPDATE em ordem de id (`travarVariosParaReserva`) →
// serviços FOR SHARE em ordem de id (`travarParaItens`) → cliente (upsert) → reserva → itens →
// consentimento → mensagem. A checagem pura entre itens (`conferirItens`, RN-8/RN-9) roda ANTES de
// qualquer INSERT (dba.md M-6): dois itens cruzados do mesmo profissional nunca chegam à exclusion.
// Todo desfecho que não é `criada` é uma exceção-sentinela (`DesfazerReserva`) lançada de dentro da
// transação, que a desfaz inteira, e capturada FORA dela. O 23P01 também é traduzido fora.
import { politicaDeOperacao } from '@/server/assinatura/politica-operacao';
import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import { registrarMensagem } from '@/server/mensagens/registrar';
import type { ResultadoRegistro } from '@/server/mensagens/tipos';
import { registrarConsentimentoDaReserva } from '@/server/consentimento/servico';
import { upsertCliente } from '@/server/clientes/servico';
import { consultarDisponibilidadePorServico, horarioOferecido } from '@/server/disponibilidade/servico';
import { repos } from '@/server/repos';
import { chaveVinculo } from '@/server/repos/servico';
import type { ReservaDTO } from '@/server/repos/tipos';
import { emTransacao } from '@/server/repos/transacao';
import { exigirEscopo } from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';
import { partesLocais } from '@/server/tempo/fuso';
import { validarConsentimentoDaReserva } from '@/server/consentimento/validacao';

import { ehConflitoDeSobreposicao } from './erros-banco';
import { conferirItens, envelope } from './itens';
import { conferirCompativel, itensCriados, montarItens, paraReservaCriada } from './montar-itens';
import { MENSAGENS_RESERVA } from './tipos';
import type {
  DependenciasCriarReserva,
  EntradaCriarReserva,
  ErrosReserva,
  PoliticaDeReserva,
  ReservaCriada,
  ResultadoCriarReserva,
} from './tipos';
import { validarEntradaReserva } from './validacao';

/** Política padrão (D-038 RN-4): equipe e público (sistema) passam pela mesma política por estado. */
export const politicaPadraoDeReserva: PoliticaDeReserva = politicaDeOperacao;

type SaidaDeNegocio = Extract<
  ResultadoCriarReserva,
  {
    resultado:
      | 'horario_indisponivel'
      | 'servico_indisponivel'
      | 'profissional_indisponivel'
      | 'invalido'
      | 'recusado'
      | 'encaixe_requer_confirmacao';
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

const indicesDe = (n: number): number[] => Array.from({ length: n }, (_, k) => k);

/** Erros de `inicio` nos itens dados, no formato `porItem`. */
function errosDeInicio(indices: readonly number[], mensagem: string): ErrosReserva {
  return { porItem: Object.fromEntries(indices.map((k) => [k, { inicio: mensagem }])) };
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
      itens: v.ok ? v.itens.length : null,
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

  if (deps.decidirEncaixe && v.modo !== 'encaixe') {
    throw new RangeError('decidirEncaixe só é aceito com modo encaixe');
  }
  if (deps.consentimentoOpcional && ctx.tipo !== 'tenant') {
    throw new RangeError('consentimentoOpcional só é aceito com contexto de equipe');
  }
  const aceites = validarConsentimentoDaReserva(entrada.aceites);
  const semConsentimento = !aceites.ok && deps.consentimentoOpcional === true;
  if (!aceites.ok && !semConsentimento) {
    return concluir({ resultado: 'consentimento_ausente', erros: aceites.erros });
  }

  const decisao = await (deps.politica ?? politicaPadraoDeReserva)(ctx, 'agendar', entrada.agora);
  if (!decisao.permitido) {
    if (ctx.tipo === 'tenant') throw new AcessoNegado(decisao.motivo);
    return concluir({ resultado: 'salao_indisponivel' });
  }

  if (v.malformados.profissionais.length > 0) {
    return concluir({ resultado: 'profissional_indisponivel', itens: v.malformados.profissionais });
  }
  if (v.malformados.servicos) return concluir({ resultado: 'servico_indisponivel' });

  const pedidos = v.itens;

  /** RN-14: a reserva já gravada com a chave é a mesma requisição ou uma chave reutilizada. */
  const porChave = async (): Promise<ResultadoCriarReserva | null> => {
    if (v.chave === null) return null;
    const existente: ReservaDTO | null = await repos().reservas.buscarPorChave(ctx, v.chave);
    if (existente === null) return null;
    return conferirCompativel(existente, pedidos)
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
      // 2. Salão FOR SHARE (fuso e intervalo vigentes).
      const { fuso, intervaloMin } = await r.saloes.travarParaLeitura(ctx);

      // 3. Profissionais distintos dos itens, FOR NO KEY UPDATE em ordem de id.
      const profs = await r.profissionais.travarVariosParaReserva(
        ctx,
        pedidos.map((p) => p.profissionalId),
      );
      const semProfissional = pedidos.flatMap((p, k) => {
        const prof = profs.get(p.profissionalId);
        return prof === null || prof === undefined || !prof.ativo ? [k] : [];
      });
      if (semProfissional.length > 0) return sair({ resultado: 'profissional_indisponivel', itens: semProfissional });

      // 4. Serviços FOR SHARE em ordem de id + vínculos dos pares (depois da trava).
      const servicoIds = pedidos.map((p) => p.servicoId);
      const travados = await r.servicos.travarParaItens(ctx, servicoIds, pedidos);
      const servicoPorId = new Map(travados.map((s) => [s.id.toLowerCase(), s]));
      if (servicoIds.some((id) => !servicoPorId.get(id)?.ativo)) return sair({ resultado: 'servico_indisponivel' });
      const semVinculo = pedidos.flatMap((p, k) => (travados.vinculados.has(chaveVinculo(p.servicoId, p.profissionalId)) ? [] : [k]));
      if (semVinculo.length > 0) return sair({ resultado: 'profissional_indisponivel', itens: semVinculo });

      // 5. Itens com o snapshot dos serviços travados.
      const itens = montarItens(pedidos, servicoPorId, intervaloMin);

      // 6. Checagem pura entre itens, ANTES de qualquer INSERT (RN-3, RN-8, RN-9; dba.md M-6).
      const conferencia = conferirItens(
        itens.map((i) => ({ ...i, status: 'confirmado' as const })),
        fuso,
      );
      if (!conferencia.ok) {
        if (conferencia.motivo === 'data_diferente') {
          return sair({ resultado: 'invalido', erros: errosDeInicio(conferencia.itens, MENSAGENS_RESERVA.dataDiferente) });
        }
        return sair({
          resultado: 'horario_indisponivel',
          causa: 'entre_itens',
          itens: conferencia.itens,
          conflitos: conferencia.conflitos,
        });
      }

      // 7. Revalidação (normal) ou decisão de encaixe (equipe).
      if (v.modo === 'normal') {
        const dia = partesLocais(itens[0].inicio, fuso).data;
        let consulta;
        try {
          consulta = await consultarDisponibilidadePorServico(
            ctx,
            {
              servicoIds,
              de: dia,
              ate: dia,
              agora: entrada.agora,
              escolhidos: pedidos,
              profissionalPorServico: Object.fromEntries(pedidos.map((p) => [p.servicoId, p.profissionalId])),
            },
            r.disponibilidade,
          );
        } catch (e) {
          if (e instanceof NaoEncontrado) return sair({ resultado: 'profissional_indisponivel', itens: indicesDe(pedidos.length) });
          throw e;
        }
        if (consulta.resultado === 'servico_indisponivel') return sair({ resultado: 'servico_indisponivel' });
        if (consulta.resultado === 'entrada_invalida') {
          return sair({ resultado: 'invalido', erros: errosDeInicio(indicesDe(pedidos.length), MENSAGENS_RESERVA.inicio) });
        }
        const resultado = consulta;
        const falharam = pedidos.flatMap((p, k) => {
          const doServico = resultado.servicos.find((s) => s.servicoId === p.servicoId);
          return doServico !== undefined && horarioOferecido(doServico, p.profissionalId, p.inicio) ? [] : [k];
        });
        if (falharam.length > 0) return sair({ resultado: 'horario_indisponivel', causa: 'revalidacao', itens: falharam });
        await deps.aposRevalidar?.();
      } else {
        const passados = itens.flatMap((i, k) => (i.inicio.getTime() < entrada.agora.getTime() ? [k] : []));
        if (passados.length > 0) {
          return sair({ resultado: 'invalido', erros: errosDeInicio(passados, MENSAGENS_RESERVA.inicioPassado) });
        }
        if (deps.decidirEncaixe) {
          const decisao = await deps.decidirEncaixe(ctx, r, {
            fuso,
            itens: itens.map(({ inicio, fim, profissionalId }) => ({ inicio, fim, profissionalId })),
          });
          if ('motivos' in decisao) return sair({ resultado: 'encaixe_requer_confirmacao', motivos: decisao.motivos });
          if (decisao.encaixes.length !== itens.length) throw new Error('decidirEncaixe devolveu um flag por item a mais ou a menos');
          itens.forEach((i, k) => {
            i.encaixe = decisao.encaixes[k];
          });
        } else {
          for (const i of itens) i.encaixe = true;
        }
      }

      // 8. Cliente → limite (E4.2) → reserva → itens → consentimento → mensagem.
      const cliente = await upsertCliente(ctx, { nome: entrada.cliente.nome, telefone: entrada.cliente.telefone }, r);
      if (cliente.resultado !== 'ok') throw new Error('upsert da cliente recusou uma entrada já validada');
      const clienteId = cliente.cliente.id;

      const env = envelope(itens.map((i) => ({ ...i, status: 'confirmado' as const })));
      if (deps.antesDaReserva) {
        const liberado = await deps.antesDaReserva(ctx, r, { clienteId, inicio: env.inicio });
        if (!liberado.permitido) return sair({ resultado: 'recusado', motivo: liberado.motivo });
      }

      const origem = ctx.tipo === 'tenant' ? 'equipe' : 'publico';
      const inserida = await r.reservas.criar(ctx, {
        clienteId,
        origem,
        chaveRequisicao: v.chave,
        inicio: env.inicio,
        fim: env.fim,
      });
      if (!inserida.criada) return sair({ resultado: 'chave_repetida' });
      const ids = await r.reservas.criarItens(ctx, inserida.id, itens);

      if (!semConsentimento) {
        const consentimento = await registrarConsentimentoDaReserva(
          ctx,
          { clienteId, aceites: entrada.aceites, origem, agora: entrada.agora },
          r,
        );
        if (!consentimento.ok) throw new Error('consentimento recusou aceites já validados');
      }

      const registro = await registrarMensagem(ctx, { reservaId: inserida.id, tipo: 'confirmacao' }, entrada.agora, r);

      return {
        registro,
        reserva: {
          id: inserida.id,
          clienteId,
          inicio: env.inicio,
          fim: env.fim,
          status: 'confirmado',
          origem,
          revisao: 0,
          itens: itensCriados(itens, ids),
        },
      };
    });
    saida = { resultado: 'criada', criada };
  } catch (e) {
    if (e instanceof DesfazerReserva) {
      saida = e.saida;
    } else if (ehConflitoDeSobreposicao(e)) {
      // 9. O 23P01 não diz qual item caiu (R-6): itens vazio.
      saida = { resultado: 'horario_indisponivel', causa: '23P01', itens: [] };
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

  // RN-14: qualquer indisponibilidade ou a chave repetida com chave relê por chave, fora da transação.
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
