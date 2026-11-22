import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashDoToken } from '@/server/tenant/sessao';

import {
  ASSUNTO_CONVITE,
  LIMITE_ENVIOS,
  MENSAGENS_CONVITE,
  VALIDADE_CONVITE_MS,
  aceitarConvite,
  chaveDeConvite,
  enviarConvite,
  estadoDoConvite,
  linkDeConvite,
  montarEmailConvite,
  novoTokenDeConvite,
  validarSenhaDoConvite,
  verificarConvite,
} from './convite';

// D-039 (unidade): funções puras do convite de profissional. CA-3 (limites da validade), CA-13 (senha),
// CA-1 (token, link, e-mail, chave do limite). Os caminhos que recusam pelo formato não tocam o banco.

const T = new Date('2026-11-19T12:00:00.000Z');
const DIA_MS = 24 * 60 * 60 * 1000;
const em = (ms: number) => new Date(T.getTime() + ms);

describe('estadoDoConvite', () => {
  const base = { aceitoEm: null, invalidadoEm: null, expiraEm: em(7 * DIA_MS) };

  it('válido até 1 ms antes de expirar; expirado em expira_em e depois', () => {
    expect(estadoDoConvite(base, em(7 * DIA_MS - 1))).toBe('valido');
    expect(estadoDoConvite(base, em(7 * DIA_MS))).toBe('expirado');
    expect(estadoDoConvite(base, em(8 * DIA_MS))).toBe('expirado');
  });

  it('"usado" tem precedência sobre invalidado e expirado; invalidado sobre expirado', () => {
    expect(estadoDoConvite({ ...base, aceitoEm: T, invalidadoEm: T }, em(30 * DIA_MS))).toBe('ja_utilizado');
    expect(estadoDoConvite({ ...base, invalidadoEm: T }, em(30 * DIA_MS))).toBe('invalidado');
    expect(estadoDoConvite({ ...base, invalidadoEm: T }, T)).toBe('invalidado');
  });
});

describe('token, link e chave', () => {
  it('7 dias de validade; só o SHA-256 vai para o banco; o token de 32 bytes tem 43 caracteres', () => {
    expect(VALIDADE_CONVITE_MS).toBe(7 * DIA_MS);
    const n = novoTokenDeConvite(T);
    expect(n.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(n.tokenHash).toBe(hashDoToken(n.token));
    expect(n.tokenHash).not.toContain(n.token);
    expect(n.expiraEm.getTime()).toBe(T.getTime() + 7 * DIA_MS);
    expect(novoTokenDeConvite(T, () => 'fixo').token).toBe('fixo');
    expect(novoTokenDeConvite(T).token).not.toBe(n.token);
  });

  it('o link usa APP_URL e põe o token no caminho', () => {
    expect(linkDeConvite('https://app.exemplo.com.br', 'abc_DEF-1')).toBe('https://app.exemplo.com.br/convite/abc_DEF-1');
    expect(linkDeConvite('http://localhost:3000/', 'x')).toBe('http://localhost:3000/convite/x');
    expect(() => linkDeConvite('sem url', 'x')).toThrow();
  });

  it('a chave do limite é "convite:" + SHA-256 do id, sem o id em claro; o limite é 3', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(chaveDeConvite(id)).toBe(`convite:${createHash('sha256').update(id).digest('hex')}`);
    expect(chaveDeConvite(id)).not.toContain(id);
    expect(LIMITE_ENVIOS).toBe(3);
  });
});

describe('e-mail do convite', () => {
  it('texto pt-BR com nome, salão, link, 7 dias e uso único; sem salão, "um salão"', () => {
    const m = montarEmailConvite({ para: 'ana@exemplo.com', nome: 'Ana', nomeSalao: 'Aurora', link: 'https://x/convite/t' });
    expect(m).toMatchObject({ para: 'ana@exemplo.com', assunto: ASSUNTO_CONVITE });
    expect(m.texto).toContain('Olá, Ana!');
    expect(m.texto).toContain('o salão "Aurora"');
    expect(m.texto).toContain('https://x/convite/t');
    expect(m.texto).toContain('7 dias');
    expect(m.texto).toContain('só pode ser usado uma vez');
    expect(montarEmailConvite({ para: 'a@b.com', nome: 'A', nomeSalao: null, link: 'l' }).texto).toContain('de um salão');
  });

  it('enviarConvite: porta que falha, APP_URL inválida → "falhou"; porta ok → "enviado" com o link', async () => {
    const enviados: string[] = [];
    const d = { para: 'a@b.com', nome: 'A', nomeSalao: null, token: 'tok' };
    expect(
      await enviarConvite({ appUrl: 'http://app.teste', email: { enviar: async (m) => { enviados.push(m.texto); return { provedorId: '1' }; } } }, d),
    ).toBe('enviado');
    expect(enviados[0]).toContain('http://app.teste/convite/tok');
    expect(await enviarConvite({ appUrl: 'http://app.teste', email: { enviar: async () => { throw new Error('x'); } } }, d)).toBe('falhou');
    expect(await enviarConvite({ appUrl: 'nao-url', email: { enviar: async () => ({ provedorId: '1' }) } }, d)).toBe('falhou');
  });
});

describe('validarSenhaDoConvite (CA-13)', () => {
  it('8 a 1024 caracteres, sem aparar; fora disso, mensagem do convite', () => {
    expect(validarSenhaDoConvite('12345678')).toEqual({ ok: true, senha: '12345678' });
    expect(validarSenhaDoConvite('        ')).toEqual({ ok: true, senha: '        ' });
    expect(validarSenhaDoConvite('x'.repeat(1024)).ok).toBe(true);
    expect(validarSenhaDoConvite('1234567')).toEqual({ ok: false, erro: MENSAGENS_CONVITE.senhaCurta });
    expect(validarSenhaDoConvite(undefined)).toEqual({ ok: false, erro: MENSAGENS_CONVITE.senhaCurta });
    expect(validarSenhaDoConvite(12345678)).toEqual({ ok: false, erro: MENSAGENS_CONVITE.senhaCurta });
    expect(validarSenhaDoConvite('x'.repeat(1025))).toEqual({ ok: false, erro: MENSAGENS_CONVITE.senhaLonga });
  });
});

describe('recusa pelo formato (sem banco)', () => {
  it('token malformado ou não texto: aceite e verificação recusam com a mensagem única e logam só o motivo', async () => {
    const linhas: string[] = [];
    for (const token of ['', 'curto', `${'T'.repeat(42)}!`, undefined, 7]) {
      expect(await aceitarConvite({ token, senha: 'senha-valida-1' }, { agora: T, log: (l) => linhas.push(l) })).toEqual({
        resultado: 'recusado',
        mensagem: MENSAGENS_CONVITE.recusado,
        detalhe: 'invalido',
      });
      expect(await verificarConvite(token, { agora: T, log: (l) => linhas.push(l) })).toEqual({ ok: false, motivo: 'invalido' });
    }
    expect(linhas).toHaveLength(10);
    expect(JSON.parse(linhas[0])).toEqual({ evento: 'auth.convite_aceite', resultado: 'recusado', detalhe: 'invalido', em: T.toISOString() });
  });

  it('token bom e senha ruim: erro de campo antes de qualquer consulta ao banco', async () => {
    const r = await aceitarConvite({ token: 'T'.repeat(43), senha: '123' }, { agora: T, log: () => {} });
    expect(r).toEqual({ resultado: 'invalido', erros: { senha: MENSAGENS_CONVITE.senhaCurta } });
  });
});
