import { formatarData } from '@/lib/format';
import {
  LIMITE_ENVIOS,
  chaveDeConvite,
  enviarConvite,
  novoTokenDeConvite,
} from '@/server/auth/convite';
import type { DepsConvite } from '@/server/auth/convite';
import { inicioDaJanela } from '@/server/auth/login';
import { exigirPermissao } from '@/server/auth/permissoes';
import { normalizarEmailOpcional } from '@/server/profissionais/validacao';
import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { MENSAGENS_CONVITE, SEM_CONVITE } from './tipos';
import type { EstadoConviteVisao, ResultadoConvidar } from './tipos';

// Serviço do convite pelo lado do gestor (D-039 §3; RN-1..RN-7, RN-11..RN-13). Sem next/*. O aceite
// (pré-autenticação) está em auth/convite.ts. Resultados de negócio são discriminados; o acesso e a
// existência continuam ErroDeDominio (401/403/404).

/** Rollback do que a transação gravou (convite novo e invalidação) quando o limite estoura. */
class DesfazerConvite extends Error {}

/** Log de uma linha, só com ids (sem e-mail nem token). */
function registrar(evento: string, dados: Record<string, unknown>): void {
  console.info(JSON.stringify({ evento, ...dados }));
}

function exigirId(e: unknown): string {
  const id = typeof e === 'object' && e !== null && !Array.isArray(e) ? (e as { id?: unknown }).id : undefined;
  if (typeof id !== 'string') {
    throw new NaoEncontrado();
  }
  return id;
}

type Interno =
  | { tipo: 'pronto'; token: string; expiraEm: Date; email: string; nome: string; nomeSalao: string | null }
  | { tipo: 'invalido'; resultado: ResultadoConvidar };

const recusa = (erros: { email?: string; formulario?: string }): Interno => ({
  tipo: 'invalido',
  resultado: { resultado: 'invalido', erros },
});

/**
 * RN-1..RN-7, RN-11..RN-13. Uma transação READ COMMITTED: profissional FOR NO KEY UPDATE → recusas
 * (inativo, já tem acesso, sem e-mail, e-mail em uso) → invalida os pendentes → insere o convite →
 * incrementa a janela (acima do limite desfaz tudo). Depois do commit: e-mail síncrono; falha no envio
 * não desfaz o convite. O token em claro só existe na memória.
 */
export async function convidar(
  ctx: TenantContext,
  e: unknown,
  agora: Date,
  deps: DepsConvite = {},
): Promise<ResultadoConvidar> {
  exigirPermissao(ctx, 'profissional.gerir');
  const id = exigirId(e);
  let interno: Interno;
  try {
    interno = await emTransacao(async (t): Promise<Interno> => {
      const p = await t.convites.travarProfissionalParaConvite(ctx, id);
      if (!p.ativo) return recusa({ formulario: MENSAGENS_CONVITE.inativo });
      if (p.usuarioId !== null) return recusa({ formulario: MENSAGENS_CONVITE.jaTemAcesso });
      const email = normalizarEmailOpcional(p.email);
      if (typeof email !== 'string') return recusa({ email: MENSAGENS_CONVITE.semEmail });
      if (await t.convites.emailEmUso(ctx, email)) return recusa({ email: MENSAGENS_CONVITE.emailEmUso });

      await t.convites.invalidarPendentes(ctx, id, agora);
      const novo = novoTokenDeConvite(agora, deps.gerarToken);
      await t.convites.inserir(ctx, { profissionalId: id, email, tokenHash: novo.tokenHash, expiraEm: novo.expiraEm, agora });
      const contador = await t.convites.contarEnvioNaJanela(chaveDeConvite(id), inicioDaJanela(agora));
      if (contador > LIMITE_ENVIOS) {
        throw new DesfazerConvite();
      }
      return { tipo: 'pronto', token: novo.token, expiraEm: novo.expiraEm, email, nome: p.nome, nomeSalao: p.nomeSalao };
    });
  } catch (erro) {
    if (erro instanceof DesfazerConvite) {
      registrar('convite.limite', { salaoId: ctx.salaoId, profissionalId: id });
      return { resultado: 'limite' };
    }
    throw erro;
  }
  if (interno.tipo === 'invalido') {
    return interno.resultado;
  }
  const envio = await enviarConvite(deps, {
    para: interno.email,
    nome: interno.nome,
    nomeSalao: interno.nomeSalao,
    token: interno.token,
  });
  registrar('convite.criado', { salaoId: ctx.salaoId, profissionalId: id, emailEnviado: envio === 'enviado' });
  return { resultado: 'criado', emailEnviado: envio === 'enviado', expiraEm: interno.expiraEm.toISOString() };
}

/** CA-16: estado do convite mais recente de cada profissional, no fuso do salão. Ausente = sem convite. */
export async function estadoDosConvites(
  ctx: TenantContext,
  ids: readonly string[],
  agora: Date,
): Promise<Record<string, EstadoConviteVisao>> {
  exigirPermissao(ctx, 'profissional.gerir');
  const ultimos = await repos().convites.ultimoPorProfissional(ctx, ids);
  const saida: Record<string, EstadoConviteVisao> = {};
  for (const u of ultimos) {
    if (u.aceitoEm !== null) {
      saida[u.profissionalId] = { estado: 'aceito', ate: null };
    } else if (u.invalidadoEm !== null) {
      saida[u.profissionalId] = SEM_CONVITE;
    } else {
      const ate = formatarData(u.expiraEm, u.fusoSalao);
      saida[u.profissionalId] =
        agora.getTime() >= u.expiraEm.getTime() ? { estado: 'expirado', ate } : { estado: 'pendente', ate };
    }
  }
  return saida;
}
