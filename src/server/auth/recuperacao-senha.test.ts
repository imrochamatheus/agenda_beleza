import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { hashDoToken } from '@/server/tenant/sessao';

import {
  ASSUNTO_RECUPERACAO,
  MENSAGENS_RECUPERACAO,
  VALIDADE_RECUPERACAO_MS,
  chaveDeRecuperacao,
  elegivelParaRecuperacao,
  estadoDoToken,
  linkDeRedefinicao,
  montarEmailRecuperacao,
  novoTokenDeRecuperacao,
  redefinirSenha,
  validarNovaSenha,
  verificarLinkDeRedefinicao,
} from './recuperacao-senha';

// D-012 T-3 (unidade): funções puras do serviço de recuperação de senha. CA-4 (limites de expiração
// em ms), CA-7 (validação da senha), CA-9/CA-14 (elegibilidade), RN-5 (token e link), RN-9 (e-mail)
// e RN-8 (chave do limite). Os caminhos que recusam pelo formato não tocam o banco.

const T = new Date('2026-11-19T12:00:00.000Z');
const HORA_MS = 60 * 60 * 1000;
const em = (ms: number) => new Date(T.getTime() + ms);

describe('estadoDoToken (CA-4, unidade)', () => {
  const vivo = { usadoEm: null, invalidadoEm: null, expiraEm: em(HORA_MS) };

  it('validade de 1 h em milissegundos: T+1h−1ms válido; T+1h e T+1h+1s expirados', () => {
    expect(VALIDADE_RECUPERACAO_MS).toBe(HORA_MS);
    expect(estadoDoToken(vivo, em(HORA_MS - 1))).toBe('valido');
    expect(estadoDoToken(vivo, em(HORA_MS))).toBe('expirado_ou_substituido');
    expect(estadoDoToken(vivo, em(HORA_MS + 1000))).toBe('expirado_ou_substituido');
  });

  it('usado → ja_utilizado (precedência sobre expirado e invalidado); invalidado → expirado_ou_substituido', () => {
    expect(estadoDoToken({ ...vivo, usadoEm: T }, T)).toBe('ja_utilizado');
    expect(estadoDoToken({ usadoEm: T, invalidadoEm: T, expiraEm: em(-1) }, T)).toBe('ja_utilizado');
    expect(estadoDoToken({ ...vivo, invalidadoEm: T }, T)).toBe('expirado_ou_substituido');
  });
});

describe('elegivelParaRecuperacao (RN-6, D-2)', () => {
  it.each([
    [{ papel: 'gestor', profissionalAtivo: true }, true],
    [{ papel: 'gestor', profissionalAtivo: false }, true],
    [{ papel: 'gestor', profissionalAtivo: null }, true],
    [{ papel: 'profissional', profissionalAtivo: true }, true],
    [{ papel: 'profissional', profissionalAtivo: false }, false],
    [{ papel: 'profissional', profissionalAtivo: null }, false],
    [{ papel: 'super_admin', profissionalAtivo: null }, false],
  ] as const)('%o → %s', (perfil, esperado) => {
    expect(elegivelParaRecuperacao(perfil)).toBe(esperado);
  });
});

describe('validarNovaSenha (CA-7, RN-11)', () => {
  it('7 caracteres, ausente e não-string → senhaCurta; 1025 → senhaLonga', () => {
    for (const v of ['1234567', '', undefined, null, 12345678, ['12345678']]) {
      expect(validarNovaSenha(v)).toEqual({ ok: false, erro: MENSAGENS_RECUPERACAO.senhaCurta });
    }
    expect(validarNovaSenha('x'.repeat(1025))).toEqual({ ok: false, erro: MENSAGENS_RECUPERACAO.senhaLonga });
  });

  it('8 espaços e 1024 caracteres são aceitos, sem aparar', () => {
    expect(validarNovaSenha('        ')).toEqual({ ok: true, senha: '        ' });
    expect(validarNovaSenha(' a'.repeat(512))).toEqual({ ok: true, senha: ' a'.repeat(512) });
  });
});

describe('token, link, e-mail e chave', () => {
  it('novoTokenDeRecuperacao: 43 caracteres base64url, hash SHA-256 diferente do token, expira em +1 h', () => {
    const t = novoTokenDeRecuperacao(T);
    expect(t.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.tokenHash).toBe(hashDoToken(t.token));
    expect(t.tokenHash).not.toBe(t.token);
    expect(t.expiraEm).toEqual(em(HORA_MS));
    expect(novoTokenDeRecuperacao(T, () => 'fixo').token).toBe('fixo');
  });

  it('linkDeRedefinicao: usa APP_URL (com ou sem barra final) e /redefinir-senha?token=', () => {
    expect(linkDeRedefinicao('https://app.exemplo.com', 'abc')).toBe('https://app.exemplo.com/redefinir-senha?token=abc');
    expect(linkDeRedefinicao('https://app.exemplo.com/', 'abc')).toBe('https://app.exemplo.com/redefinir-senha?token=abc');
  });

  it('montarEmailRecuperacao: assunto, nome, link, 1 hora, uso único, sair de todos os dispositivos, ignore; texto puro', () => {
    const m = montarEmailRecuperacao({ para: 'ana@exemplo.com', nome: '<b>Ana</b>', link: 'https://x/redefinir-senha?token=abc' });
    expect(m.para).toBe('ana@exemplo.com');
    expect(m.assunto).toBe(ASSUNTO_RECUPERACAO);
    expect(ASSUNTO_RECUPERACAO).toBe('Redefinição de senha no Agenda Beleza');
    expect(m.texto).toContain('Olá, <b>Ana</b>!');
    expect(m.texto).toContain('https://x/redefinir-senha?token=abc');
    expect(m.texto).toContain('1 hora');
    expect(m.texto).toContain('só pode ser usado uma vez');
    expect(m.texto).toContain('sai de todos os dispositivos');
    expect(m.texto).toContain('Se você não pediu, ignore esta mensagem: sua senha atual continua valendo.');
    expect(Object.keys(m).sort()).toEqual(['assunto', 'para', 'texto']);
  });

  it('chaveDeRecuperacao: prefixo próprio + SHA-256, sem o e-mail em claro', () => {
    const k = chaveDeRecuperacao('ana@exemplo.com');
    expect(k).toMatch(/^recuperacao-senha:[0-9a-f]{64}$/);
    expect(k).not.toContain('ana');
    expect(chaveDeRecuperacao('outra@exemplo.com')).not.toBe(k);
  });
});

describe('recusas pelo formato, sem banco (CA-6)', () => {
  it('verificarLinkDeRedefinicao: ausente, vazio, 10 KB, fora do formato e não-string → invalido, com log', async () => {
    const linhas: string[] = [];
    for (const t of [undefined, '', 'A'.repeat(10 * 1024), 'curto', 'A'.repeat(42) + '!', ['x'], 42]) {
      expect(await verificarLinkDeRedefinicao(t, { agora: T, log: (l) => linhas.push(l) })).toEqual({ ok: false, motivo: 'invalido' });
    }
    expect(JSON.parse(linhas[0])).toEqual({
      evento: 'auth.redefinicao_senha_link',
      resultado: 'recusado',
      detalhe: 'invalido',
      em: T.toISOString(),
    });
  });

  it('redefinirSenha: token malformado → recusado/invalido sem calcular hash; senha inválida → validacao sem hash', async () => {
    let hashes = 0;
    const deps = {
      agora: T,
      log: () => {},
      hashSenha: async () => {
        hashes += 1;
        return 'x';
      },
    };
    expect(await redefinirSenha({ token: 'curto', senha: 'senha-boa-1' }, deps)).toEqual({
      ok: false,
      motivo: 'recusado',
      detalhe: 'invalido',
      mensagem: MENSAGENS_RECUPERACAO.recusado,
    });
    expect(await redefinirSenha({ token: 'A'.repeat(43), senha: 'curta' }, deps)).toEqual({
      ok: false,
      motivo: 'validacao',
      erros: { senha: MENSAGENS_RECUPERACAO.senhaCurta },
    });
    expect(hashes).toBe(0);
  });
});

describe('fronteiras do módulo', () => {
  it('sem next/* e sem adaptadores concretos de e-mail', () => {
    const fonte = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'recuperacao-senha.ts'), 'utf8');
    expect(fonte).not.toMatch(/from\s+['"]next(\/|['"])/);
    expect(fonte).not.toMatch(/integrations\/email\/(real|simulado)/);
  });
});
