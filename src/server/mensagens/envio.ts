import { ErroEnvioPermanente, ErroEnvioTemporario } from '@/server/integrations/whatsapp/port';
import type { PortaWhatsApp } from '@/server/integrations/whatsapp/port';
import { repoMensagemSistema } from '@/server/repos/mensagem-sistema';
import type { RepoMensagemSistema } from '@/server/repos/mensagem-sistema';
import type { ContextoDeEnvio, DecisaoDeEnvio } from '@/server/repos/tipos';
import { contextoDeSistema } from '@/server/tenant/context';

import { chaveDaMensagem } from './chave';
import { conferirVigencia, decidirElegibilidade } from './elegibilidade';
import { montarParametros, montarParametrosConvite } from './parametros';
import { CODIGOS_ERRO } from './tipos';
import type { GeradorLinkAvaliacao } from './tipos';

// Núcleo do envio (D-024 §3.7), testável sem pg-boss. Três tempos curtos e NENHUMA transação aberta
// durante a chamada ao adaptador (RN-17): T1 reivindica e decide, a porta é chamada, T2 fecha.

export type CamposDeLog = Record<string, string | number | null>;

export type DependenciasEnvio = {
  whatsapp: () => PortaWhatsApp;
  /** Sem gerador, o `convite_avaliacao` falha como `link_indisponivel` (A-9). */
  gerarLink?: GeradorLinkAvaliacao;
  agora: () => Date;
  sistema?: RepoMensagemSistema;
  /** Só `mensagemId`, `tipo`, `revisao`, `tentativa`, `estado`, `erroCodigo` (RN-22). */
  log: (evento: string, campos: CamposDeLog) => void;
};

/** `concluida`: o job termina; `reagendar`: o handler lança para o pg-boss repetir com backoff. */
export type ResultadoDoEnvio = 'concluida' | 'reagendar';

const ORIGEM = 'worker-mensagens';
const CODIGO_VALIDO = /^[a-z0-9_]{1,40}$/;
const DETALHE = {
  temporaria: 'falha temporária',
  permanente: 'falha permanente',
} as const;

/**
 * Decisão de T1 (função pura): cliente anonimizada vence; depois a vigência pelos itens lidos no envio
 * (D-050 RN-30); depois o consentimento (RN-8). Usa a MESMA `decidirElegibilidade` do registro.
 */
export function decidirNoEnvio(c: ContextoDeEnvio): DecisaoDeEnvio {
  const e = decidirElegibilidade({
    tipo: c.tipo,
    clienteAnonimizada: c.clienteAnonimizada,
    telefone: c.telefone,
    consentimentoMensagens: c.consentimentoMensagens,
    consentimentoConvite: c.consentimentoConvite,
  });
  if (e.acao === 'terminal' && e.estado === 'cancelada_anonimizacao') {
    return e;
  }
  if (conferirVigencia(c.tipo, { revisao: c.mensagemRevisao }, { status: c.reserva.status, itens: c.itens }) === 'obsoleta') {
    return { acao: 'terminal', estado: 'substituida', erroCodigo: CODIGOS_ERRO.obsoleta };
  }
  return e;
}

function codigoDe(erro: { codigo: string }): string {
  return CODIGO_VALIDO.test(erro.codigo) ? erro.codigo : CODIGOS_ERRO.erroDesconhecido;
}

type Classificada = { permanente: boolean; erroCodigo: string };

/** A-6: permanente só para `ErroEnvioPermanente`; o resto (inclusive `NaoImplementado`) é temporário. */
function classificar(erro: unknown): Classificada {
  if (erro instanceof ErroEnvioPermanente) return { permanente: true, erroCodigo: codigoDe(erro) };
  if (erro instanceof ErroEnvioTemporario) return { permanente: false, erroCodigo: codigoDe(erro) };
  return { permanente: false, erroCodigo: CODIGOS_ERRO.erroDesconhecido };
}

export async function enviarMensagem(
  mensagemId: string,
  tentativa: { atual: number; maxima: number },
  deps: DependenciasEnvio,
): Promise<ResultadoDoEnvio> {
  const sistema = deps.sistema ?? repoMensagemSistema();
  const alvo = await sistema.localizar(mensagemId);
  if (alvo === null) {
    deps.log('mensagem.nao_encontrada', { mensagemId });
    return 'concluida';
  }

  const inicio = await sistema.iniciarEnvio(alvo.salaoId, mensagemId, deps.agora(), decidirNoEnvio);
  if (inicio.resultado === 'nao_reivindicada') {
    deps.log('mensagem.nao_reivindicada', { mensagemId, estado: alvo.estado });
    return 'concluida';
  }
  if (inicio.resultado === 'terminal') {
    deps.log('mensagem.encerrada', {
      mensagemId,
      tipo: inicio.tipo,
      revisao: inicio.revisao,
      estado: inicio.estado,
      erroCodigo: inicio.erroCodigo,
    });
    return 'concluida';
  }

  const { tentativaId, numero, contexto: c } = inicio;
  const base = { mensagemId, tipo: inicio.tipo, revisao: inicio.revisao, tentativa: numero };
  const chave = chaveDaMensagem(inicio.reservaId, inicio.tipo, inicio.revisao);

  // Chamada ao adaptador: só o que acontece até aqui pode virar "falha de envio". Um erro ao fechar o
  // sucesso (T2) NÃO pode ser tratado como falha: reenviaria o que já saiu (R-2); ele propaga, o job é
  // reentregue, não reivindica e a reconciliação fecha como resultado incerto.
  let provedorMensagemId: string;
  try {
    let parametros: Record<string, string>;
    if (inicio.tipo === 'convite_avaliacao') {
      // O link só existe nesta variável até `enviarModelo`: nunca vai a log, a erro nem a gravação (RN-14).
      const link = await produzirLink(deps.gerarLink, alvo.salaoId, inicio.reservaId);
      parametros = montarParametrosConvite(c.salaoNome, link);
    } else {
      parametros = montarParametros(inicio.tipo, {
        salaoNome: c.salaoNome,
        fuso: c.fuso,
        itens: c.itens,
        revisao: inicio.revisao,
      });
    }
    const r = await deps.whatsapp().enviarModelo({
      destinatarioE164: inicio.destinatarioE164,
      modelo: inicio.tipo,
      parametros,
      chaveIdempotencia: chave,
    });
    provedorMensagemId = r.provedorMensagemId;
  } catch (erro) {
    const { permanente, erroCodigo } = classificar(erro);
    const temRetentativa = !permanente && tentativa.atual < tentativa.maxima;
    const estadoFinal = temRetentativa ? 'pendente' : 'falhou';
    const escreveu = await sistema.concluirEnvio(
      alvo.salaoId,
      mensagemId,
      tentativaId,
      {
        resultado: 'falha',
        estadoFinal,
        erroCodigo,
        erroDetalhe: permanente ? DETALHE.permanente : DETALHE.temporaria,
      },
      deps.agora(),
    );
    deps.log(escreveu ? 'mensagem.tentativa_falhou' : 'mensagem.fechamento_ignorado', {
      ...base,
      estado: escreveu ? estadoFinal : null,
      erroCodigo,
    });
    return escreveu && temRetentativa ? 'reagendar' : 'concluida';
  }

  const escreveu = await sistema.concluirEnvio(
    alvo.salaoId,
    mensagemId,
    tentativaId,
    { resultado: 'sucesso', provedorMensagemId },
    deps.agora(),
  );
  deps.log(escreveu ? 'mensagem.enviada' : 'mensagem.fechamento_ignorado', {
    ...base,
    estado: escreveu ? 'enviada' : null,
  });
  return 'concluida';
}

async function produzirLink(gerar: GeradorLinkAvaliacao | undefined, salaoId: string, reservaId: string): Promise<string> {
  if (!gerar) {
    throw new ErroEnvioPermanente(CODIGOS_ERRO.linkIndisponivel);
  }
  let link: unknown;
  try {
    link = await gerar(contextoDeSistema(salaoId, ORIGEM), reservaId);
  } catch {
    // A causa pode conter o link ou dados pessoais: descartada (RN-14, RN-22).
    throw new ErroEnvioPermanente(CODIGOS_ERRO.linkIndisponivel);
  }
  if (typeof link !== 'string' || link.trim() === '') {
    throw new ErroEnvioPermanente(CODIGOS_ERRO.linkIndisponivel);
  }
  return link;
}
