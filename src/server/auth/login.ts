import { createHash } from 'node:crypto';

import { z } from 'zod';

import { decrementarJanela, incrementarJanela } from '@/server/repos/rate-limit';
import { buscarUsuarioParaLogin } from '@/server/repos/usuario';

import { destinoAposLogin } from './destino';
import { HASH_FICTICIO, verificarSenha } from './senha';
import type { VerificadorSenha } from './senha';
import { iniciarSessaoSeSenhaVigente } from './sessao';

// Serviço de login da equipe (D-010 §3.9; RN-2, RN-6..RN-8, RN-19, RN-22, RN-25). Pré-autenticação:
// não é defineAcao nem arquivo *.acao.ts (RN-24). Sem next/*: a casca (entrar/acoes.ts) grava o
// cookie e redireciona.

export const MENSAGENS_LOGIN = Object.freeze({
  credenciais: 'E-mail ou senha incorretos.',
  naoConfirmado: 'Confirme seu e-mail antes de entrar.',
  desativado: 'Seu acesso está desativado. Fale com a gestão do salão.',
  limite: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  emailVazio: 'Informe seu e-mail.',
  senhaVazia: 'Informe sua senha.',
});

/** Falhas permitidas por e-mail numa janela (D-3). A 11ª tentativa da janela é recusada. */
export const LIMITE_FALHAS = 10;
/** Janela fixa de 15 min, alinhada ao relógio UTC (D-3). */
export const JANELA_MS = 15 * 60 * 1000;

export type ResultadoLogin =
  | { ok: true; token: string; destino: string }
  | { ok: false; motivo: 'validacao'; erros: { email?: string; senha?: string } }
  | {
      ok: false;
      motivo: 'recusado';
      mensagem: string;
      /** Só no caso "e-mail não confirmado" (senha conferida): a tela oferece o reenvio (D-011 RN-16). */
      reenvioDisponivel?: true;
    };

export type DepsLogin = {
  /** Relógio (testes). */
  agora?: Date;
  /** Verificador de senha (testes instrumentam o número de chamadas). */
  verificarSenha?: VerificadorSenha;
  /** Saída de log (padrão console.info). Nunca recebe e-mail, senha, token, hash nem chave. */
  log?: (linha: string) => void;
};

type ResultadoLog = 'ok' | 'credenciais' | 'nao_confirmado' | 'desativado' | 'limite';

const esquemaEmail = z.string().trim().toLowerCase().max(254).pipe(z.email());
// A senha não é aparada nem normalizada (RN-6). O teto evita custo abusivo do argon2.
const esquemaSenha = z.string().min(1).max(1024);

/** Chave do rate limit: 'login:' + SHA-256 do e-mail normalizado (sem o e-mail em claro). */
export function chaveDeLogin(emailNormalizado: string): string {
  return `login:${createHash('sha256').update(emailNormalizado, 'utf8').digest('hex')}`;
}

/** Início da janela fixa de 15 min que contém `agora` (UTC). */
export function inicioDaJanela(agora: Date): Date {
  return new Date(Math.floor(agora.getTime() / JANELA_MS) * JANELA_MS);
}

const recusa = (mensagem: string): ResultadoLogin => ({ ok: false, motivo: 'recusado', mensagem });

/**
 * Login por e-mail e senha. Ordem (RN-7): validação → rate limit (reserva atômica, D-3) → busca do
 * usuário → UMA verificação argon2 (hash fictício se o e-mail não existe, RN-8) → mensagem genérica
 * para inexistente, senha errada ou super admin → e-mail não confirmado / profissional desativado
 * (só com a senha correta) → sessão. Só o sucesso devolve a reserva do rate limit.
 */
export async function entrar(
  entrada: { email: unknown; senha: unknown; proximo?: unknown },
  deps: DepsLogin = {},
): Promise<ResultadoLogin> {
  const email = esquemaEmail.safeParse(entrada.email);
  const senha = esquemaSenha.safeParse(entrada.senha);
  if (!email.success || !senha.success) {
    return {
      ok: false,
      motivo: 'validacao',
      erros: {
        ...(email.success ? {} : { email: MENSAGENS_LOGIN.emailVazio }),
        ...(senha.success ? {} : { senha: MENSAGENS_LOGIN.senhaVazia }),
      },
    };
  }

  const agora = deps.agora ?? new Date();
  const verificar = deps.verificarSenha ?? verificarSenha;
  const registrar = (resultado: ResultadoLog, usuarioId?: string) =>
    (deps.log ?? console.info)(
      JSON.stringify({
        evento: 'auth.login',
        resultado,
        ...(usuarioId === undefined ? {} : { usuarioId }),
        em: agora.toISOString(),
      }),
    );

  const chave = chaveDeLogin(email.data);
  const janela = inicioDaJanela(agora);
  if ((await incrementarJanela(chave, janela)) > LIMITE_FALHAS) {
    registrar('limite');
    return recusa(MENSAGENS_LOGIN.limite);
  }

  const usuario = await buscarUsuarioParaLogin(email.data);
  const senhaConfere = await verificar(usuario?.senhaHash ?? HASH_FICTICIO, senha.data);

  if (!usuario || !senhaConfere || usuario.papel === 'super_admin') {
    registrar('credenciais');
    return recusa(MENSAGENS_LOGIN.credenciais);
  }
  if (!usuario.emailConfirmado) {
    registrar('nao_confirmado');
    return { ok: false, motivo: 'recusado', mensagem: MENSAGENS_LOGIN.naoConfirmado, reenvioDisponivel: true };
  }
  if (usuario.papel === 'profissional' && usuario.profissionalAtivo !== true) {
    registrar('desativado');
    return recusa(MENSAGENS_LOGIN.desativado);
  }

  // D-012 RN-13/D-11: a sessão só nasce se o hash verificado ainda é o vigente (corrida com a
  // redefinição de senha). Recusada, conta como falha (sem devolver a reserva) e responde como
  // credencial errada (D-19). A reserva do rate limit só volta depois da sessão criada.
  const sessao = await iniciarSessaoSeSenhaVigente(usuario.id, usuario.senhaHash, agora);
  if (sessao === null) {
    registrar('credenciais');
    return recusa(MENSAGENS_LOGIN.credenciais);
  }
  await decrementarJanela(chave, janela);
  registrar('ok', usuario.id);
  return { ok: true, token: sessao.token, destino: destinoAposLogin(entrada.proximo) };
}
