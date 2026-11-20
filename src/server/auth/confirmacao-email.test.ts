import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErroEnvioEmail, ErroValidacaoEmail } from '@/server/integrations/email/port';
import type { PortaEmail } from '@/server/integrations/email/port';
import { hashDoToken } from '@/server/tenant/sessao';

import {
  ASSUNTO_CONFIRMACAO,
  FORMATO_TOKEN,
  MENSAGENS_CONFIRMACAO,
  VALIDADE_CONFIRMACAO_MS,
  chaveDeReenvio,
  confirmarEmail,
  enviarEmailDeConfirmacao,
  enviarLinkDeConfirmacao,
  linkDeConfirmacao,
  montarEmailConfirmacao,
  novoTokenDeConfirmacao,
  reenviarConfirmacao,
} from './confirmacao-email';

// D-011 T-3 (unidade): token, link, e-mail, chave do limite, envio tolerante a falha e as entradas
// recusadas antes de qualquer acesso ao banco (CA-14). Sem banco: a DATABASE_URL aponta para uma
// porta fechada nos casos que provam "sem consulta".

const T0 = new Date('2026-11-19T12:00:00.000Z');
const TOKEN = 'A'.repeat(43);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('novoTokenDeConfirmacao', () => {
  it('43 caracteres base64url, hash = hashDoToken, expira em +24 h', () => {
    const r = novoTokenDeConfirmacao(T0);
    expect(r.token).toMatch(FORMATO_TOKEN);
    expect(r.tokenHash).toBe(hashDoToken(r.token));
    expect(r.tokenHash).not.toBe(r.token);
    expect(r.expiraEm.getTime() - T0.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(VALIDADE_CONFIRMACAO_MS).toBe(86_400_000);
    expect(novoTokenDeConfirmacao(T0).token).not.toBe(r.token);
  });

  it('aceita gerador injetado', () => {
    expect(novoTokenDeConfirmacao(T0, () => TOKEN)).toEqual({
      token: TOKEN,
      tokenHash: hashDoToken(TOKEN),
      expiraEm: new Date('2026-11-20T12:00:00.000Z'),
    });
  });
});

describe('FORMATO_TOKEN', () => {
  it.each([
    [TOKEN, true],
    ['abc_DEF-123'.padEnd(43, 'x'), true],
    ['A'.repeat(42), false],
    ['A'.repeat(44), false],
    [`${'A'.repeat(42)}=`, false],
    [`${'A'.repeat(42)}+`, false],
    ['', false],
  ])('%s → %s', (t, ok) => {
    expect(FORMATO_TOKEN.test(t)).toBe(ok);
  });
});

describe('linkDeConfirmacao', () => {
  it('APP_URL com e sem barra final; nunca usa outro host', () => {
    expect(linkDeConfirmacao('http://localhost:3000', TOKEN)).toBe(`http://localhost:3000/confirmar-email?token=${TOKEN}`);
    expect(linkDeConfirmacao('https://app.exemplo.com.br/', TOKEN)).toBe(
      `https://app.exemplo.com.br/confirmar-email?token=${TOKEN}`,
    );
  });

  it('codifica o token', () => {
    expect(linkDeConfirmacao('http://x.test', 'a b&c')).toBe('http://x.test/confirmar-email?token=a+b%26c');
  });
});

describe('montarEmailConfirmacao', () => {
  it('assunto, nome, salão, link e "24 horas", texto puro sem html', () => {
    const link = linkDeConfirmacao('http://x.test', TOKEN);
    const m = montarEmailConfirmacao({ para: 'ana@exemplo.com', nomeGestor: 'Ana Souza', nomeSalao: 'Studio Bela', link });
    expect(m.para).toBe('ana@exemplo.com');
    expect(m.assunto).toBe(ASSUNTO_CONFIRMACAO);
    expect(m.assunto).toBe('Confirme seu e-mail no Agenda Beleza');
    expect(m.texto).toContain('Ana Souza');
    expect(m.texto).toContain('Studio Bela');
    expect(m.texto).toContain(link);
    expect(m.texto).toContain('24 horas');
    expect(m).not.toHaveProperty('html');
  });

  it('sem nome de salão: texto genérico', () => {
    const m = montarEmailConfirmacao({ para: 'a@b.com', nomeGestor: 'X', nomeSalao: null, link: 'http://l' });
    expect(m.texto).toContain('o seu cadastro');
    expect(m.texto).not.toContain('salão "');
  });
});

describe('chaveDeReenvio', () => {
  it('prefixo + SHA-256 hex, sem o e-mail em claro, distinta da chave do login', () => {
    const k = chaveDeReenvio('ana@exemplo.com');
    expect(k).toMatch(/^reenvio-confirmacao:[0-9a-f]{64}$/);
    expect(k).not.toContain('ana');
    expect(chaveDeReenvio('ana@exemplo.com')).toBe(k);
    expect(chaveDeReenvio('bia@exemplo.com')).not.toBe(k);
  });
});

describe('enviarEmailDeConfirmacao (RN-15)', () => {
  const m = montarEmailConfirmacao({ para: 'a@b.com', nomeGestor: 'X', nomeSalao: 'S', link: 'http://l' });

  it('sucesso → enviado', async () => {
    const porta: PortaEmail = { enviar: vi.fn(async () => ({ provedorId: '1' })) };
    expect(await enviarEmailDeConfirmacao(porta, m)).toBe('enviado');
    expect(porta.enviar).toHaveBeenCalledWith(m);
  });

  it.each([
    ['ErroEnvioEmail', new ErroEnvioEmail('conexao', true)],
    ['ErroValidacaoEmail', new ErroValidacaoEmail('para')],
    ['erro qualquer', new Error('inesperado')],
    ['valor não-Error', 'falhou'],
  ])('%s → falhou, sem relançar', async (_nome, erro) => {
    const porta: PortaEmail = {
      enviar: async () => {
        throw erro;
      },
    };
    expect(await enviarEmailDeConfirmacao(porta, m)).toBe('falhou');
  });
});

describe('enviarLinkDeConfirmacao (RN-12, RN-15)', () => {
  const dados = { para: 'ana@exemplo.com', nomeGestor: 'Ana', nomeSalao: 'S', token: TOKEN };

  it('monta o link com a APP_URL informada e envia pela porta', async () => {
    const enviar = vi.fn(async () => ({ provedorId: '1' }));
    expect(await enviarLinkDeConfirmacao({ email: { enviar }, appUrl: 'https://app.test' }, dados)).toBe('enviado');
    const [[m]] = enviar.mock.calls as unknown as [[{ para: string; texto: string }]];
    expect(m.para).toBe('ana@exemplo.com');
    expect(m.texto).toContain(`https://app.test/confirmar-email?token=${TOKEN}`);
  });

  it('APP_URL do ambiente por padrão; ambiente inválido → falhou sem chamar a porta', async () => {
    const enviar = vi.fn(async () => ({ provedorId: '1' }));
    vi.stubEnv('APP_URL', 'https://do-ambiente.test');
    expect(await enviarLinkDeConfirmacao({ email: { enviar } }, dados)).toBe('enviado');
    expect(JSON.stringify(enviar.mock.calls)).toContain('https://do-ambiente.test/confirmar-email?token=');
    enviar.mockClear();
    vi.stubEnv('APP_URL', 'ftp://invalida');
    expect(await enviarLinkDeConfirmacao({ email: { enviar } }, dados)).toBe('falhou');
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe('CA-14 (unidade): entradas recusadas sem consultar o banco', () => {
  const semBanco = () => vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha@127.0.0.1:1/z');

  it('confirmarEmail: ausente, vazio, não-string, malformado e 10 KB → invalido; loga sem o token', async () => {
    semBanco();
    const linhas: string[] = [];
    const deps = { agora: T0, log: (l: string) => linhas.push(l) };
    const grande = 'A'.repeat(10 * 1024);
    for (const t of [undefined, null, '', 42, ['x'], 'curto', grande, `${'A'.repeat(42)}=`]) {
      expect(await confirmarEmail(t, deps)).toBe('invalido');
    }
    expect(linhas).toHaveLength(8);
    expect(JSON.parse(linhas[0])).toEqual({ evento: 'auth.confirmacao_email', resultado: 'invalido', em: T0.toISOString() });
    expect(linhas.join('\n')).not.toContain('AAAAAAAAAA');
  });

  it('reenviarConfirmacao: token malformado → mensagem uniforme; e-mail inválido → validação', async () => {
    semBanco();
    const linhas: string[] = [];
    const deps = { agora: T0, log: (l: string) => linhas.push(l) };
    for (const token of [undefined, '', 'x', 'A'.repeat(10 * 1024), 7]) {
      expect(await reenviarConfirmacao({ token }, deps)).toEqual({ ok: true, mensagem: MENSAGENS_CONFIRMACAO.reenvioUniforme });
    }
    for (const email of ['', 'sem-arroba', 42, `${'a'.repeat(250)}@x.com`, 'a@b.com\nBcc: c@d.com']) {
      expect(await reenviarConfirmacao({ email }, deps)).toEqual({
        ok: false,
        motivo: 'validacao',
        erros: { email: MENSAGENS_CONFIRMACAO.emailInvalido },
      });
    }
    expect(linhas.map((l) => JSON.parse(l).resultado)).toEqual([
      ...Array(5).fill('ignorado'),
      ...Array(5).fill('validacao'),
    ]);
  });
});
