import { createHash } from 'node:crypto';

import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_CONVITE } from '@/server/convites/tipos';
import { validarEnv } from '@/server/env';
import type { MensagemEmail, PortaEmail } from '@/server/integrations/email/port';
import { integracoes } from '@/server/integrations/registry';
import { aceitarConvitePorHash, buscarConvitePorHash } from '@/server/repos/convite-publico';
import type { ConviteVisto, MotivoRecusaDeAceite } from '@/server/repos/convite-publico';
import { hashDoToken } from '@/server/tenant/sessao';

import { FORMATO_TOKEN, enviarEmailDeConfirmacao } from './confirmacao-email';
import { validarNovaSenha } from './recuperacao-senha';
import { gerarHashSenha } from './senha';
import { gerarToken } from './sessao';

// Convite de profissional (D-039 §2; RN-2..RN-14). O aceite é pré-autenticação: não é defineAcao nem
// *.acao.ts, e não cria sessão (sem login automático). Sem next/*. O banco guarda só o SHA-256 do token;
// o valor em claro existe apenas no link enviado. O e-mail sai pela porta do registro (adaptador).

export { MENSAGENS_CONVITE };

/** Validade do convite (RN-2). */
export const VALIDADE_CONVITE_MS = 7 * 24 * 60 * 60 * 1000;
/** Envios por profissional numa janela fixa de 15 min (JANELA_MS do login; RN-12). */
export const LIMITE_ENVIOS = 3;
export const ASSUNTO_CONVITE = 'Seu convite para o Agenda Beleza';

export type EstadoDoLink = 'valido' | 'ja_utilizado' | 'invalidado' | 'expirado';

/** RN-10: válido sse não aceito, não invalidado e agora < expiraEm. "Usado" tem precedência no motivo. */
export function estadoDoConvite(
  c: { aceitoEm: Date | null; invalidadoEm: Date | null; expiraEm: Date },
  agora: Date,
): EstadoDoLink {
  if (c.aceitoEm !== null) {
    return 'ja_utilizado';
  }
  if (c.invalidadoEm !== null) {
    return 'invalidado';
  }
  return agora.getTime() >= c.expiraEm.getTime() ? 'expirado' : 'valido';
}

/** Token novo, seu hash (o que vai para o banco) e expira_em = agora + 7 dias. */
export function novoTokenDeConvite(
  agora: Date,
  gerar: () => string = gerarToken,
): { token: string; tokenHash: string; expiraEm: Date } {
  const token = gerar();
  return { token, tokenHash: hashDoToken(token), expiraEm: new Date(agora.getTime() + VALIDADE_CONVITE_MS) };
}

/** Link absoluto montado com APP_URL (RN-10): nunca com o Host da requisição. O token vai no caminho. */
export function linkDeConvite(appUrl: string, token: string): string {
  return new URL(ROTAS.convite(token), appUrl).toString();
}

/** Texto puro pt-BR: nome, salão, link, validade de 7 dias, uso único. */
export function montarEmailConvite(d: {
  para: string;
  nome: string;
  nomeSalao: string | null;
  link: string;
}): MensagemEmail {
  const salao = d.nomeSalao === null ? 'um salão' : `o salão "${d.nomeSalao}"`;
  const texto = [
    `Olá, ${d.nome}!`,
    '',
    `Você foi convidada(o) para acessar a agenda de ${salao} no Agenda Beleza. Para definir a sua senha e ativar o acesso, abra o link abaixo:`,
    '',
    d.link,
    '',
    'O link vale por 7 dias e só pode ser usado uma vez.',
    'Se você não esperava este convite, ignore esta mensagem: nada será criado.',
    '',
  ].join('\n');
  return { para: d.para, assunto: ASSUNTO_CONVITE, texto };
}

/** Chave do limite: 'convite:' + SHA-256 do id do profissional (sem e-mail em claro; RN-12). */
export function chaveDeConvite(profissionalId: string): string {
  return `convite:${createHash('sha256').update(profissionalId, 'utf8').digest('hex')}`;
}

/** Política da D-012 (8 a 1024 caracteres, sem aparar), com os textos do convite. */
export function validarSenhaDoConvite(v: unknown): { ok: true; senha: string } | { ok: false; erro: string } {
  const r = validarNovaSenha(v);
  if (r.ok) {
    return r;
  }
  return { ok: false, erro: typeof v === 'string' && v.length > 1024 ? MENSAGENS_CONVITE.senhaLonga : MENSAGENS_CONVITE.senhaCurta };
}

export type DepsConvite = {
  agora?: Date;
  /** Porta de e-mail; padrão integracoes().email (resolvida dentro de try). */
  email?: PortaEmail;
  /** Padrão validarEnv(process.env).APP_URL (idem). */
  appUrl?: string;
  gerarToken?: () => string;
  hashSenha?: (senha: string) => Promise<string>;
  /** Padrão console.info. Nunca recebe e-mail, senha, token nem hash. */
  log?: (linha: string) => void;
};

/** Linha JSON de log sem dados pessoais. */
function registrar(
  deps: Pick<DepsConvite, 'log'>,
  evento: string,
  agora: Date,
  campos: Record<string, string | number | boolean>,
): void {
  (deps.log ?? console.info)(JSON.stringify({ evento, ...campos, em: agora.toISOString() }));
}

/**
 * Envia o convite pela porta do registro DEPOIS do commit (RN-13). Qualquer falha (ambiente,
 * APP_URL, adaptador) vira 'falhou', nunca exceção: o convite gravado continua valendo.
 */
export async function enviarConvite(
  deps: Pick<DepsConvite, 'email' | 'appUrl'>,
  d: { para: string; nome: string; nomeSalao: string | null; token: string },
): Promise<'enviado' | 'falhou'> {
  let porta: PortaEmail;
  let mensagem: MensagemEmail;
  try {
    porta = deps.email ?? integracoes().email;
    const appUrl = deps.appUrl ?? validarEnv(process.env).APP_URL;
    mensagem = montarEmailConvite({ para: d.para, nome: d.nome, nomeSalao: d.nomeSalao, link: linkDeConvite(appUrl, d.token) });
  } catch {
    return 'falhou';
  }
  return enviarEmailDeConfirmacao(porta, mensagem);
}

export type MotivoRecusa = 'invalido' | 'ja_utilizado' | 'invalidado' | 'expirado' | MotivoRecusaDeAceite;
export type ResultadoVerificacaoConvite = { ok: true } | { ok: false; motivo: MotivoRecusa };

const formatoValido = (t: unknown): t is string => typeof t === 'string' && FORMATO_TOKEN.test(t);

/** Validade e vínculo vistos sem trava (o aceite confere de novo sob as travas). */
function motivoDeRecusa(c: ConviteVisto, agora: Date): MotivoRecusa | null {
  const estado = estadoDoConvite(c, agora);
  if (estado !== 'valido') return estado;
  if (!c.profissionalAtivo) return 'profissional_inativo';
  if (c.profissionalTemUsuario) return 'ja_vinculado';
  if (!c.emailConfere) return 'email_divergente';
  return null;
}

/** GET da página: só verifica (nunca consome nem grava). Recusa única; o motivo só vai ao log. */
export async function verificarConvite(
  token: unknown,
  deps: Pick<DepsConvite, 'agora' | 'log'> = {},
): Promise<ResultadoVerificacaoConvite> {
  const agora = deps.agora ?? new Date();
  let r: ResultadoVerificacaoConvite = { ok: false, motivo: 'invalido' };
  if (formatoValido(token)) {
    const c = await buscarConvitePorHash(hashDoToken(token));
    const motivo = c === null ? 'invalido' : motivoDeRecusa(c, agora);
    r = motivo === null ? { ok: true } : { ok: false, motivo };
  }
  registrar(deps, 'auth.convite_link', agora, r.ok ? { resultado: 'valido' } : { resultado: 'recusado', detalhe: r.motivo });
  return r;
}

export type ResultadoAceite =
  | { resultado: 'aceito'; mensagem: string }
  | { resultado: 'invalido'; erros: { senha: string } }
  | { resultado: 'recusado'; mensagem: string; detalhe: MotivoRecusa }
  | { resultado: 'falha'; mensagem: string };

/**
 * RN-8, RN-9. Ordem: formato do token e senha (sem banco) → leitura sem trava (recusa sem custo de
 * hash) → argon2 fora da transação → transação (travas, conferências, usuário, vínculo, aceite).
 * Erro de banco vira 'falha' sem efeito (a transação desfaz tudo). Nunca cria sessão.
 */
export async function aceitarConvite(
  entrada: { token: unknown; senha: unknown },
  deps: DepsConvite = {},
): Promise<ResultadoAceite> {
  const agora = deps.agora ?? new Date();
  const recusa = (detalhe: MotivoRecusa): ResultadoAceite => {
    registrar(deps, 'auth.convite_aceite', agora, { resultado: 'recusado', detalhe });
    return { resultado: 'recusado', mensagem: MENSAGENS_CONVITE.recusado, detalhe };
  };

  if (!formatoValido(entrada.token)) {
    return recusa('invalido');
  }
  const senha = validarSenhaDoConvite(entrada.senha);
  if (!senha.ok) {
    registrar(deps, 'auth.convite_aceite', agora, { resultado: 'validacao' });
    return { resultado: 'invalido', erros: { senha: senha.erro } };
  }
  const tokenHash = hashDoToken(entrada.token);
  try {
    const visto = await buscarConvitePorHash(tokenHash);
    const motivo = visto === null ? 'invalido' : motivoDeRecusa(visto, agora);
    if (motivo !== null) {
      return recusa(motivo);
    }
    const senhaHash = await (deps.hashSenha ?? gerarHashSenha)(senha.senha);
    const r = await aceitarConvitePorHash({ tokenHash, senhaHash, agora });
    if (r.resultado !== 'aceito') {
      return recusa(r.resultado);
    }
    registrar(deps, 'auth.convite_aceite', agora, { resultado: 'ok', usuarioId: r.usuarioId, profissionalId: r.profissionalId });
    return { resultado: 'aceito', mensagem: MENSAGENS_CONVITE.sucesso };
  } catch {
    registrar(deps, 'auth.convite_aceite', agora, { resultado: 'falha' });
    return { resultado: 'falha', mensagem: MENSAGENS_CONVITE.falha };
  }
}
