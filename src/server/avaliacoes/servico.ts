import { VERSAO_TERMOS } from '@/config/termos';
import { limitarPorIp } from '@/server/protecao/limite';
import { verificarHumano } from '@/server/protecao/turnstile';
import { buscarConviteValido } from '@/server/repos/avaliacao-publica';
import { resolverSalaoPorSlug } from '@/server/repos/publico';
import { emTransacao } from '@/server/repos/transacao';
import { slugPlausivel } from '@/server/reserva-publica/passos';
import { contextoDeSistema } from '@/server/tenant/context';
import type { PublicoContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { nomeDeExibicao } from './nome';
import { hashDoToken, tokenPlausivel } from './token';
import type { EntradaEnvio, ResultadoEnvio, ResultadoVerificacao } from './tipos';
import { validarCampos } from './validacao';

// Verificação e envio da avaliação pelo link do convite (D-032 §3.3 e §3.4). Sem next/*, sem
// 'use server'. Toda recusa de link é UNIFORME (`link_invalido`): token malformado, de outro salão,
// desconhecido, usado, vencido, invalidado, reserva não `concluido` ou cliente anonimizada.

const ORIGEM = 'avaliacao_publica';

/** Sentinela: desfaz a transação e vira `link_invalido` fora dela (padrão DesfazerReserva). */
class DesfazerAvaliacao extends Error {}

function registrar(evento: string, salaoId: string | null, motivo: string): void {
  // Só ids e códigos: nunca token, nome nem comentário.
  console.info(JSON.stringify({ evento, salaoId, motivo }));
}

export type DependenciasAvaliacao = {
  limitarPorIp?: typeof limitarPorIp;
  verificarHumano?: typeof verificarHumano;
  /** Só testes: depois das travas (reserva, cliente, convite) e antes de gravar. */
  aposTravar?: () => Promise<void>;
};

async function resolver(slug: string): Promise<{ ctx: PublicoContext; historico: boolean; slugAtual: string } | null> {
  if (!slugPlausivel(slug)) return null;
  try {
    const r = await resolverSalaoPorSlug(slug);
    return { ctx: r.contexto, historico: r.historico, slugAtual: r.slugAtual };
  } catch (e) {
    if (e instanceof NaoEncontrado) return null;
    throw e;
  }
}

/** GET: limite por IP antes de tocar o token; depois a verificação em uma instrução sem trava. */
export async function verificarLink(
  slug: string,
  token: string,
  ip: string,
  agora: Date,
  deps: DependenciasAvaliacao = {},
): Promise<ResultadoVerificacao> {
  const lim = await (deps.limitarPorIp ?? limitarPorIp)(ip, 'avaliacao', agora);
  if (!lim.permitido) return { ok: false, motivo: 'limite' };
  const salao = tokenPlausivel(token) ? await resolver(slug) : null;
  if (salao === null || !tokenPlausivel(token)) return { ok: false, motivo: 'invalido' };
  const v = await buscarConviteValido(salao.ctx, hashDoToken(token), agora);
  if (v === null) return { ok: false, motivo: 'invalido' };
  return { ok: true, nomeSalao: v.nomeSalao, slugAtual: salao.slugAtual, historico: salao.historico };
}

export async function enviarAvaliacao(
  e: EntradaEnvio,
  agora: Date,
  deps: DependenciasAvaliacao = {},
): Promise<ResultadoEnvio> {
  const lim = await (deps.limitarPorIp ?? limitarPorIp)(e.ip, 'avaliacao', agora);
  if (!lim.permitido) return { resultado: 'limite_excedido' };
  if (!(await (deps.verificarHumano ?? verificarHumano)(e.tokenHumano, e.ip))) {
    return { resultado: 'verificacao_falhou' };
  }

  const salao = tokenPlausivel(e.token) ? await resolver(e.slug) : null;
  if (salao === null || !tokenPlausivel(e.token)) return { resultado: 'link_invalido' };
  const salaoId = salao.ctx.salaoId;
  const hash = hashDoToken(e.token);

  const campos = validarCampos(e);
  if (!campos.ok) {
    // Erro de campo só depois de confirmar o link: senão viraria oráculo de tokens.
    if ((await buscarConviteValido(salao.ctx, hash, agora)) === null) {
      registrar('avaliacao.recusada', salaoId, 'link_invalido');
      return { resultado: 'link_invalido' };
    }
    registrar('avaliacao.recusada', salaoId, 'campos');
    return { resultado: 'invalido_campos', erros: campos.erros };
  }

  const ctx = contextoDeSistema(salaoId, ORIGEM);
  try {
    await emTransacao(async (r) => {
      const av = r.avaliacoes;
      const convite = await av.localizarConvite(ctx, hash);
      if (convite === null) throw new DesfazerAvaliacao();
      const reserva = await av.travarReserva(ctx, convite.reservaId);
      if (reserva === null || reserva.status !== 'concluido') throw new DesfazerAvaliacao();
      const cliente = await av.travarCliente(ctx, reserva.clienteId);
      if (cliente === null || cliente.anonimizadaEm !== null) throw new DesfazerAvaliacao();
      const c = await av.travarConvite(ctx, convite.conviteId);
      if (
        c === null ||
        c.usadoEm !== null ||
        c.invalidadoEm !== null ||
        agora.getTime() >= c.expiraEm.getTime()
      ) {
        throw new DesfazerAvaliacao();
      }
      await deps.aposTravar?.();
      const nome = nomeDeExibicao(cliente.nome);
      if (nome === null) throw new DesfazerAvaliacao();
      const inserida = await av.inserir(ctx, {
        reservaId: convite.reservaId,
        clienteId: reserva.clienteId,
        nota: campos.dados.nota,
        comentario: campos.dados.comentario,
        nomeExibicao: nome,
        versaoTermos: VERSAO_TERMOS,
        agora,
      });
      if (!inserida || !(await av.marcarUsado(ctx, convite.conviteId, agora))) throw new DesfazerAvaliacao();
    });
  } catch (erro) {
    if (erro instanceof DesfazerAvaliacao) {
      registrar('avaliacao.recusada', salaoId, 'link_invalido');
      return { resultado: 'link_invalido' };
    }
    throw erro;
  }
  registrar('avaliacao.enviada', salaoId, 'enviada');
  return { resultado: 'enviada' };
}
