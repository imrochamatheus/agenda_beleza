import { afterEach, describe, expect, it, vi } from 'vitest';

import { MENSAGENS_CADASTRO, cadastrar, validarCadastro } from './cadastro';
import type { CampoCadastro } from './cadastro';

// D-011 T-4 (unidade): CA-10, validação da RN-7 sem banco. Os erros vêm todos juntos; a senha não é
// aparada; nomes são aparados com espaços colapsados; e-mail normalizado.

const VALIDO: Record<CampoCadastro, unknown> = {
  nome: 'Ana Souza',
  email: 'ana@exemplo.com',
  senha: 'senha-forte-1',
  nomeSalao: 'Studio Bela',
};

const comCampo = (campo: CampoCadastro, valor: unknown) => ({ ...VALIDO, [campo]: valor });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('CA-10: validarCadastro', () => {
  it('entrada válida → dados normalizados (trim, colapso de espaços, e-mail minúsculo)', () => {
    expect(
      validarCadastro({
        nome: '  Ana   Souza ',
        email: '  Ana.Souza@Exemplo.COM ',
        senha: ' senha com espaços ',
        nomeSalao: ' Studio  \u00a0 Bela ',
      }),
    ).toEqual({
      ok: true,
      dados: { nome: 'Ana Souza', email: 'ana.souza@exemplo.com', senha: ' senha com espaços ', nomeSalao: 'Studio Bela' },
    });
  });

  it('contraprova: senha de 8 espaços é aceita (não é aparada); 8 e 1024 caracteres nos limites', () => {
    for (const senha of ['        ', 'x'.repeat(8), 'x'.repeat(1024)]) {
      expect(validarCadastro(comCampo('senha', senha)).ok).toBe(true);
    }
  });

  it.each<[string, CampoCadastro, unknown, string]>([
    ['nome vazio', 'nome', '', MENSAGENS_CADASTRO.nome],
    ['nome com 1 caractere', 'nome', 'A', MENSAGENS_CADASTRO.nome],
    ['nome com 101 caracteres', 'nome', 'a'.repeat(101), MENSAGENS_CADASTRO.nome],
    ['nome só espaços', 'nome', '     ', MENSAGENS_CADASTRO.nome],
    ['nome com quebra de linha', 'nome', 'Ana\nSouza', MENSAGENS_CADASTRO.nome],
    ['nome com \\u0000', 'nome', 'Ana\u0000', MENSAGENS_CADASTRO.nome],
    ['nome de 10 KB', 'nome', 'a'.repeat(10 * 1024), MENSAGENS_CADASTRO.nome],
    ['nome não-texto', 'nome', 42, MENSAGENS_CADASTRO.nome],
    ['e-mail sem @', 'email', 'ana.exemplo.com', MENSAGENS_CADASTRO.email],
    ['e-mail com 255 caracteres', 'email', `${'a'.repeat(243)}@exemplo.com`, MENSAGENS_CADASTRO.email],
    ['e-mail com quebra de linha', 'email', 'ana@exemplo.com\nBcc: x@y.com', MENSAGENS_CADASTRO.email],
    ['e-mail ausente', 'email', undefined, MENSAGENS_CADASTRO.email],
    ['senha com 7 caracteres', 'senha', '1234567', MENSAGENS_CADASTRO.senhaCurta],
    ['senha com 1025 caracteres', 'senha', 'x'.repeat(1025), MENSAGENS_CADASTRO.senhaLonga],
    ['senha não-texto', 'senha', null, MENSAGENS_CADASTRO.senhaCurta],
    ['salão vazio', 'nomeSalao', '', MENSAGENS_CADASTRO.nomeSalao],
    ['salão só espaços', 'nomeSalao', '   ', MENSAGENS_CADASTRO.nomeSalao],
    ['salão com 81 caracteres', 'nomeSalao', 's'.repeat(81), MENSAGENS_CADASTRO.nomeSalao],
    ['salão com tabulação', 'nomeSalao', 'Studio\tBela', MENSAGENS_CADASTRO.nomeSalao],
    ['salão não-texto', 'nomeSalao', { x: 1 }, MENSAGENS_CADASTRO.nomeSalao],
  ])('%s → mensagem do campo', (_nome, campo, valor, mensagem) => {
    expect(validarCadastro(comCampo(campo, valor))).toEqual({ ok: false, erros: { [campo]: mensagem } });
  });

  it('e-mail com 254 caracteres é aceito', () => {
    const email = `${'a'.repeat(64)}.${'b'.repeat(60)}@${'c'.repeat(60)}.${'d'.repeat(60)}.com`.slice(0, 254);
    expect(email.length).toBeLessThanOrEqual(254);
    expect(validarCadastro(comCampo('email', email)).ok).toBe(true);
  });

  it('todos os erros juntos; campos ausentes', () => {
    expect(validarCadastro({ nome: undefined, email: undefined, senha: undefined, nomeSalao: undefined })).toEqual({
      ok: false,
      erros: {
        nome: MENSAGENS_CADASTRO.nome,
        email: MENSAGENS_CADASTRO.email,
        senha: MENSAGENS_CADASTRO.senhaCurta,
        nomeSalao: MENSAGENS_CADASTRO.nomeSalao,
      },
    });
  });

  it('nome do salão só com símbolos ou com HTML é aceito como texto', () => {
    for (const nomeSalao of ['!!! ★★★', '<b>x</b>']) {
      expect(validarCadastro(comCampo('nomeSalao', nomeSalao))).toMatchObject({ ok: true, dados: { nomeSalao } });
    }
  });
});

describe('CA-10: cadastrar com entrada inválida não toca o banco, o hash nem o e-mail', () => {
  it('validação → resultado de validação; hashSenha e a porta não são chamados; log sem dados', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha@127.0.0.1:1/z');
    const hashSenha = vi.fn(async () => 'h');
    const enviar = vi.fn(async () => ({ provedorId: '1' }));
    const linhas: string[] = [];
    const r = await cadastrar(
      { nome: 'A', email: 'x', senha: 'curta', nomeSalao: '' },
      { hashSenha, email: { enviar }, log: (l) => linhas.push(l), agora: new Date('2026-11-19T12:00:00Z') },
    );
    expect(r).toEqual({
      ok: false,
      motivo: 'validacao',
      erros: {
        nome: MENSAGENS_CADASTRO.nome,
        email: MENSAGENS_CADASTRO.email,
        senha: MENSAGENS_CADASTRO.senhaCurta,
        nomeSalao: MENSAGENS_CADASTRO.nomeSalao,
      },
    });
    expect(hashSenha).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
    expect(linhas.map((l) => JSON.parse(l))).toEqual([
      { evento: 'auth.cadastro', resultado: 'validacao', em: '2026-11-19T12:00:00.000Z' },
    ]);
  });
});
