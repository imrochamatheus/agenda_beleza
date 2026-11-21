import { createHash } from 'node:crypto';

import { z } from 'zod';

import { registrarAuditoria, registrarFalhaAuditoria } from '@/server/auditoria/registrar';
import { buscarAdminParaLogin, emTransacaoAdmin, gravarSegredoPendente, lerEstadoTotp } from '@/server/repos/admin';
import { decrementarJanela, incrementarJanela } from '@/server/repos/rate-limit';
import { criarAdminContext } from '@/server/tenant/context';
import { hashDoToken } from '@/server/tenant/sessao';

import { inicioDaJanela } from '../login';
import { HASH_FICTICIO, verificarSenha } from '../senha';
import type { VerificadorSenha } from '../senha';
import { gerarToken } from '../sessao';

import { chaveDoAmbiente, cifrarSegredo, decifrarSegredo } from './cifra';
import { gerarQrSvg } from './qr';
import { estadoDaSessaoAdmin, iniciarPreSessao } from './sessao-admin';
import { agruparChave, gerarSegredo, normalizarCodigo, uriOtpauth, verificarCodigo } from './totp';
import { expiracaoAdmin } from './validade-admin';

// Login do super admin em duas etapas (D-034 RN-6..RN-11): senha → pré-sessão; código TOTP (ou
// cadastro do TOTP no primeiro acesso) → sessão admin. Pré-autenticação: não é defineAcao. Sem next/*.
// Respostas uniformes: nada diferencia e-mail inexistente, não-admin e senha errada.

export const MENSAGENS_ADMIN = Object.freeze({
  credenciais: 'E-mail ou senha incorretos.',
  codigo: 'Código inválido ou expirado. Confira o aplicativo e tente de novo.',
  limite: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  sessao: 'Sua verificação expirou. Entre novamente.',
  emailVazio: 'Informe seu e-mail.',
  senhaVazia: 'Informe sua senha.',
  codigoVazio: 'Informe o código de 6 dígitos.',
});

/** Falhas de senha por e-mail por janela de 15 min: a 11ª é recusada (mesma mecânica do login do salão). */
export const LIMITE_LOGIN_ADMIN = 10;
/** Falhas de TOTP por usuário por janela de 15 min: a 6ª é recusada sem verificar o código. */
export const LIMITE_TOTP_ADMIN = 5;

const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');
export const chaveDeLoginAdmin = (emailNormalizado: string) => `admin-login:${sha256(emailNormalizado)}`;
export const chaveDeTotpAdmin = (usuarioId: string) => `admin-totp:${sha256(usuarioId)}`;

const esquemaEmail = z.string().trim().toLowerCase().max(254).pipe(z.email());
const esquemaSenha = z.string().min(1).max(1024);

export type DepsAdmin = {
  agora?: Date;
  verificarSenha?: VerificadorSenha;
  /** Chave AES do segredo TOTP (padrão: ADMIN_TOTP_CHAVE do ambiente, lida só quando preciso). */
  chave?: Buffer;
  log?: (linha: string) => void;
};

export type ResultadoEntrada =
  | { ok: true; token: string; etapa: 'totp' | 'cadastro' }
  | { ok: false; motivo: 'validacao'; erros: { email?: string; senha?: string } }
  | { ok: false; motivo: 'recusado'; mensagem: string };

const recusa = (mensagem: string): ResultadoEntrada => ({ ok: false, motivo: 'recusado', mensagem });

function logar(deps: DepsAdmin, evento: string, resto: Record<string, string | number | boolean>, agora: Date) {
  (deps.log ?? console.info)(JSON.stringify({ evento, ...resto, em: agora.toISOString() }));
}

/** Falha de auditoria de uma FALHA de login nunca muda a resposta (a recusa acontece de qualquer jeito). */
async function auditarFalha(deps: DepsAdmin, agora: Date, e: Parameters<typeof registrarFalhaAuditoria>[0]) {
  try {
    await registrarFalhaAuditoria(e);
  } catch {
    logar(deps, 'admin.auditoria_falha', { acao: e.acao }, agora);
  }
}

/** Validação pura da etapa 1 (também usada pela vitrine /dev/admin-entrar): sem banco. */
export function validarCredenciaisAdmin(entrada: {
  email: unknown;
  senha: unknown;
}): { ok: true; email: string; senha: string } | { ok: false; erros: { email?: string; senha?: string } } {
  const email = esquemaEmail.safeParse(entrada.email);
  const senha = esquemaSenha.safeParse(entrada.senha);
  if (!email.success || !senha.success) {
    return {
      ok: false,
      erros: {
        ...(email.success ? {} : { email: MENSAGENS_ADMIN.emailVazio }),
        ...(senha.success ? {} : { senha: MENSAGENS_ADMIN.senhaVazia }),
      },
    };
  }
  return { ok: true, email: email.data, senha: senha.data };
}

/** Etapa 1: e-mail e senha. Sucesso cria só a pré-sessão (10 min), sem auditoria de sucesso. */
export async function entrarAdmin(
  entrada: { email: unknown; senha: unknown },
  deps: DepsAdmin = {},
): Promise<ResultadoEntrada> {
  const validada = validarCredenciaisAdmin(entrada);
  if (!validada.ok) {
    return { ok: false, motivo: 'validacao', erros: validada.erros };
  }
  const agora = deps.agora ?? new Date();
  const chave = chaveDeLoginAdmin(validada.email);
  const janela = inicioDaJanela(agora);
  if ((await incrementarJanela(chave, janela)) > LIMITE_LOGIN_ADMIN) {
    logar(deps, 'admin.login', { resultado: 'limite' }, agora);
    return recusa(MENSAGENS_ADMIN.limite);
  }

  const admin = await buscarAdminParaLogin(validada.email);
  const confere = await (deps.verificarSenha ?? verificarSenha)(admin?.senhaHash ?? HASH_FICTICIO, validada.senha);
  if (!admin || !confere) {
    logar(deps, 'admin.login', { resultado: 'credenciais' }, agora);
    await auditarFalha(deps, agora, {
      acao: 'login.falha_senha',
      entidade: admin ? 'usuario' : null,
      entidadeId: admin?.id ?? null,
      atorId: admin?.id ?? null,
      atorEmailInformado: validada.email,
    });
    return recusa(MENSAGENS_ADMIN.credenciais);
  }

  const { token } = await iniciarPreSessao(admin.id, agora);
  await decrementarJanela(chave, janela);
  logar(deps, 'admin.login', { resultado: 'senha_ok', usuarioId: admin.id }, agora);
  return { ok: true, token, etapa: admin.totpAtivado ? 'totp' : 'cadastro' };
}

export type ResultadoFator =
  | { ok: true; token: string }
  | { ok: false; motivo: 'invalido' | 'limite' | 'sessao' | 'ativado' };

/** Interrompe a transação (rollback) e devolve o motivo; nunca sai deste módulo. */
class DesfazerFator extends Error {
  constructor(readonly motivo: 'invalido' | 'sessao') {
    super('fator desfeito');
  }
}

/**
 * Núcleo comum da verificação do código (modo 'login') e do cadastro do TOTP (modo 'cadastro').
 * Ordem: formato (sem banco) → sessão e estado → limite de 5 falhas (ANTES de verificar, vale com o
 * código certo) → decifra → compara → UMA transação (anti-replay atômico, pré-sessão revogada, sessão
 * admin nova, auditoria). Falhas são auditadas em conexão própria DEPOIS do rollback.
 */
async function verificarFator(
  modo: 'login' | 'cadastro',
  tokenPre: string,
  codigo: unknown,
  deps: DepsAdmin,
): Promise<ResultadoFator> {
  if (normalizarCodigo(codigo) === null) {
    return { ok: false, motivo: 'invalido' };
  }
  const agora = deps.agora ?? new Date();
  const estadoSessao = await estadoDaSessaoAdmin(tokenPre, agora);
  if (estadoSessao.tipo !== 'preauth') {
    return { ok: false, motivo: 'sessao' };
  }
  const usuarioId = estadoSessao.usuarioId;
  const estado = await lerEstadoTotp(usuarioId);
  if (estado === null || estado.segredoCifrado === null) {
    return { ok: false, motivo: 'sessao' };
  }
  if (modo === 'cadastro' && estado.ativadoEm !== null) {
    return { ok: false, motivo: 'ativado' };
  }
  if (modo === 'login' && estado.ativadoEm === null) {
    return { ok: false, motivo: 'sessao' };
  }

  const janela = inicioDaJanela(agora);
  const chaveLimite = chaveDeTotpAdmin(usuarioId);
  if ((await incrementarJanela(chaveLimite, janela)) > LIMITE_TOTP_ADMIN) {
    logar(deps, 'admin.totp', { resultado: 'limite', usuarioId }, agora);
    return { ok: false, motivo: 'limite' };
  }

  const falha = async (motivo: 'invalido' | 'sessao'): Promise<ResultadoFator> => {
    logar(deps, 'admin.totp', { resultado: motivo, usuarioId }, agora);
    if (motivo === 'invalido') {
      await auditarFalha(deps, agora, {
        acao: 'login.falha_totp',
        entidade: 'usuario',
        entidadeId: usuarioId,
        atorId: usuarioId,
        atorEmailInformado: estado.email,
        depois: { etapa: modo },
      });
    }
    return { ok: false, motivo };
  };

  const segredo = decifrarSegredo(estado.segredoCifrado, usuarioId, deps.chave ?? chaveDoAmbiente());
  const passo = verificarCodigo(segredo, codigo as string, agora);
  if (passo === null || (estado.ultimoPasso !== null && passo <= estado.ultimoPasso)) {
    return falha('invalido');
  }

  const novoToken = gerarToken();
  try {
    await emTransacaoAdmin(async (op, r) => {
      if (modo === 'login') {
        if (!(await op.avancarPasso(usuarioId, passo))) throw new DesfazerFator('invalido');
      } else if (!(await op.ativarTotp({ usuarioId, segredoCifrado: estado.segredoCifrado!, passo, agora }))) {
        throw new DesfazerFator('invalido');
      }
      if (!(await op.revogarPreSessao(hashDoToken(tokenPre), agora))) throw new DesfazerFator('sessao');
      await op.criarSessaoAdmin({
        usuarioId,
        tokenHash: hashDoToken(novoToken),
        agora,
        expiraEm: expiracaoAdmin(agora, agora),
      });
      const ctx = criarAdminContext(usuarioId);
      if (modo === 'cadastro') {
        await registrarAuditoria(
          ctx,
          { acao: 'totp.cadastrar', entidade: 'usuario', entidadeId: usuarioId, depois: { metodo: 'totp' } },
          r,
        );
      }
      await registrarAuditoria(
        ctx,
        { acao: 'login.sucesso', entidade: 'usuario', entidadeId: usuarioId, depois: { etapa: modo } },
        r,
      );
    });
  } catch (e) {
    if (e instanceof DesfazerFator) {
      if (e.motivo === 'invalido' && modo === 'cadastro') {
        // Outro cadastro concorrente venceu: o segundo fator já está ativo.
        const atual = await lerEstadoTotp(usuarioId);
        if (atual?.ativadoEm != null) {
          return { ok: false, motivo: 'ativado' };
        }
      }
      return falha(e.motivo);
    }
    throw e;
  }
  // O sucesso devolve a unidade do limite (não pune o uso legítimo, R-5); falha aqui não desfaz a sessão.
  await decrementarJanela(chaveLimite, janela).catch(() => undefined);
  logar(deps, 'admin.totp', { resultado: 'ok', usuarioId }, agora);
  return { ok: true, token: novoToken };
}

/** Etapa 2 (TOTP já ativo): código válido → sessão admin (token novo; a pré-sessão é revogada). */
export function verificarTotpAdmin(token: string, codigo: unknown, deps: DepsAdmin = {}): Promise<ResultadoFator> {
  return verificarFator('login', token, codigo, deps);
}

/** Primeiro acesso: confirma o código do segredo pendente, ativa o TOTP e abre a sessão admin. */
export function cadastrarTotp(token: string, codigo: unknown, deps: DepsAdmin = {}): Promise<ResultadoFator> {
  return verificarFator('cadastro', token, codigo, deps);
}

export type CadastroTotp =
  | { ok: true; chaveAgrupada: string; svg: string; email: string }
  | { ok: false; motivo: 'sessao' | 'ativado' };

/**
 * Dados da tela de cadastro. Gera o segredo uma vez, cifrado e ainda sem ativação (S-1); recarregar a
 * página (ou o POST sem JS) reaproveita o MESMO segredo. Devolve o segredo só para renderizar.
 */
export async function obterCadastroTotp(token: string, deps: DepsAdmin = {}): Promise<CadastroTotp> {
  const agora = deps.agora ?? new Date();
  const sessao = await estadoDaSessaoAdmin(token, agora);
  if (sessao.tipo !== 'preauth') {
    return { ok: false, motivo: 'sessao' };
  }
  let estado = await lerEstadoTotp(sessao.usuarioId);
  if (estado === null) {
    return { ok: false, motivo: 'sessao' };
  }
  if (estado.ativadoEm !== null) {
    return { ok: false, motivo: 'ativado' };
  }
  const chave = deps.chave ?? chaveDoAmbiente();
  if (estado.segredoCifrado === null) {
    await gravarSegredoPendente(estado.id, cifrarSegredo(gerarSegredo(), estado.id, chave));
    // Corrida: se outra requisição gravou primeiro, ambas leem o mesmo segredo.
    estado = await lerEstadoTotp(sessao.usuarioId);
    if (estado === null || estado.segredoCifrado === null) {
      return { ok: false, motivo: 'sessao' };
    }
    if (estado.ativadoEm !== null) {
      return { ok: false, motivo: 'ativado' };
    }
  }
  const segredo = decifrarSegredo(estado.segredoCifrado, estado.id, chave);
  return {
    ok: true,
    chaveAgrupada: agruparChave(segredo),
    svg: gerarQrSvg(uriOtpauth(estado.email, segredo), 'QR code para o aplicativo autenticador'),
    email: estado.email,
  };
}

/** Etapa da pré-sessão do cookie: 'totp' (já cadastrado), 'cadastro' (primeiro acesso) ou null (inválida). */
export async function etapaDaPreSessao(token: string, agora: Date = new Date()): Promise<'totp' | 'cadastro' | null> {
  const sessao = await estadoDaSessaoAdmin(token, agora);
  if (sessao.tipo !== 'preauth') {
    return null;
  }
  const estado = await lerEstadoTotp(sessao.usuarioId);
  if (estado === null) {
    return null;
  }
  return estado.ativadoEm === null ? 'cadastro' : 'totp';
}
