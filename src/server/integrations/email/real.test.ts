import { inspect } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { portaFechada } from '../../../../tests/support/stubs/http';
import { iniciarStubSmtp, type StubSmtp } from '../../../../tests/support/stubs/smtp';
import { ErroEnvioEmail, ErroValidacaoEmail, type MensagemEmail } from './port';
import {
  criarEmailReal,
  type EmailReal,
  opcoesDoTransporte,
  type OpcoesEmailReal,
  TIMEOUTS_SMTP_MS,
  traduzirErroSmtp,
} from './real';

const USUARIO = 'smtp-usuario@agenda.test';
const SENHA = 'senha-SMTP-ultra-secreta-9f3b';
// Forma que vai no `AUTH PLAIN` e que o stub ecoa na recusa (R-2).
const SENHA_BASE64 = Buffer.from(`\0${USUARIO}\0${SENHA}`).toString('base64');
const SENHA_SO_BASE64 = Buffer.from(SENHA).toString('base64');
const REMETENTE = 'nao-responda@agenda.test';
// Tempos-limite curtos: os testes de falha de conexão terminam bem abaixo de 2 s.
const TIMEOUTS_CURTOS = { conexao: 300, saudacao: 300, socket: 300, dns: 300 };

const MENSAGEM: MensagemEmail = {
  para: 'cliente@exemplo.com',
  assunto: 'Confirme seu cadastro',
  texto: 'Acesse http://localhost:3000/confirmar?token=abc123 para confirmar.',
};

function opcoes(stub: { host: string; porta: number }, extra: Partial<OpcoesEmailReal> = {}) {
  return {
    host: stub.host,
    porta: stub.porta,
    seguro: false,
    autenticacao: { usuario: USUARIO, senha: SENHA },
    remetente: REMETENTE,
    exigirTls: false,
    timeouts: TIMEOUTS_CURTOS,
    ...extra,
  } satisfies OpcoesEmailReal;
}

/** Serializa tudo o que o erro carrega: message, stack, cause (recursivo) e todas as propriedades. */
function serializarErro(erro: unknown, profundidade = 0): string {
  if (profundidade > 5) return '';
  if (typeof erro !== 'object' || erro === null) return String(erro);
  const partes: string[] = [inspect(erro, { showHidden: true, depth: 10 })];
  for (const chave of Object.getOwnPropertyNames(erro)) {
    const valor = (erro as Record<string, unknown>)[chave];
    partes.push(`${chave}=${typeof valor === 'object' ? serializarErro(valor, profundidade + 1) : String(valor)}`);
  }
  const { message, stack, cause } = erro as { message?: unknown; stack?: unknown; cause?: unknown };
  partes.push(String(message), String(stack), serializarErro(cause, profundidade + 1));
  try {
    partes.push(JSON.stringify(erro));
  } catch {
    // Estrutura circular: as partes acima já cobrem o conteúdo.
  }
  return partes.join('\n');
}

function capturarSaida() {
  const espioes = [
    vi.spyOn(console, 'log'),
    vi.spyOn(console, 'info'),
    vi.spyOn(console, 'warn'),
    vi.spyOn(console, 'error'),
    vi.spyOn(console, 'debug'),
    vi.spyOn(process.stdout, 'write'),
    vi.spyOn(process.stderr, 'write'),
  ];
  return () => espioes.flatMap((e) => e.mock.calls.map((c) => c.map(String).join(' '))).join('\n');
}

const SEGREDOS = [SENHA, SENHA_BASE64, SENHA_SO_BASE64];

function semSegredos(texto: string) {
  for (const segredo of SEGREDOS) expect(texto).not.toContain(segredo);
}

async function falha(promessa: Promise<unknown>): Promise<unknown> {
  try {
    await promessa;
  } catch (erro) {
    return erro;
  }
  throw new Error('a promessa deveria ter rejeitado');
}

let stub: StubSmtp;
let porta: EmailReal | undefined;

beforeEach(async () => {
  stub = await iniciarStubSmtp({ credenciais: { usuario: USUARIO, senha: SENHA } });
});

afterEach(async () => {
  porta?.fechar();
  porta = undefined;
  vi.restoreAllMocks();
  await stub.fechar();
});

describe('opcoesDoTransporte (§3.9, R-3, RN-22)', () => {
  const base = {
    host: 'smtp.exemplo.com',
    porta: 587,
    seguro: false,
    autenticacao: { usuario: 'u', senha: 's' },
    remetente: REMETENTE,
  };

  it('repassa host, porta, TLS implícito e credenciais; desliga logger, debug e acesso a arquivo/URL', () => {
    expect(opcoesDoTransporte(base)).toEqual({
      host: 'smtp.exemplo.com',
      port: 587,
      secure: false,
      auth: { user: 'u', pass: 's' },
      requireTLS: true,
      connectionTimeout: TIMEOUTS_SMTP_MS.conexao,
      greetingTimeout: TIMEOUTS_SMTP_MS.saudacao,
      socketTimeout: TIMEOUTS_SMTP_MS.socket,
      dnsTimeout: TIMEOUTS_SMTP_MS.dns,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  });

  it('R-3: exige STARTTLS quando há autenticação sem TLS implícito', () => {
    expect(opcoesDoTransporte(base).requireTLS).toBe(true);
  });

  it('não exige STARTTLS com TLS implícito (465) nem sem autenticação', () => {
    expect(opcoesDoTransporte({ ...base, seguro: true, porta: 465 })).toMatchObject({
      secure: true,
      port: 465,
      requireTLS: false,
    });
    const semAuth = opcoesDoTransporte({ ...base, autenticacao: null });
    expect(semAuth.requireTLS).toBe(false);
    expect(semAuth).not.toHaveProperty('auth');
  });

  it('exigirTls explícito prevalece nos dois sentidos', () => {
    expect(opcoesDoTransporte({ ...base, exigirTls: false }).requireTLS).toBe(false);
    expect(opcoesDoTransporte({ ...base, autenticacao: null, exigirTls: true }).requireTLS).toBe(true);
  });

  it('tempos-limite padrão de 10 s por fase, cada um substituível', () => {
    expect(TIMEOUTS_SMTP_MS).toEqual({ conexao: 10_000, saudacao: 10_000, socket: 10_000, dns: 10_000 });
    expect(opcoesDoTransporte({ ...base, timeouts: { saudacao: 50 } })).toMatchObject({
      connectionTimeout: 10_000,
      greetingTimeout: 50,
      socketTimeout: 10_000,
      dnsTimeout: 10_000,
    });
  });
});

describe('traduzirErroSmtp (§3.9, R-2)', () => {
  it.each([
    [{ code: 'EAUTH', responseCode: 535, permanent: true }, 'autenticacao', false],
    [{ code: 'EENVELOPE', responseCode: 550, permanent: true }, 'recusado', false],
    [{ code: 'EENVELOPE', responseCode: 451, permanent: false }, 'recusado', true],
    [{ code: 'EPROTOCOL', command: 'RCPT TO', responseCode: 553, permanent: true }, 'recusado', false],
    [{ code: 'EPROTOCOL', command: 'MAIL FROM', responseCode: 550, permanent: true }, 'recusado', false],
    [{ code: 'EPROTOCOL', command: 'RCPT TO', responseCode: 450, permanent: false }, 'outro', true],
    [{ code: 'EMESSAGE', command: 'DATA', responseCode: 554, permanent: true }, 'outro', false],
    [{ code: 'ECONNECTION' }, 'conexao', true],
    [{ code: 'ETIMEDOUT' }, 'conexao', true],
    [{ code: 'ESOCKET' }, 'conexao', true],
    [{ code: 'EDNS' }, 'conexao', true],
    [{ code: 'ECONNREFUSED' }, 'conexao', true],
    [{ code: 'ETLS' }, 'outro', true],
    [{}, 'outro', true],
  ])('%o → %s (temporario=%s)', (original, codigo, temporario) => {
    const erro = traduzirErroSmtp(Object.assign(new Error('original'), original));
    expect(erro).toBeInstanceOf(ErroEnvioEmail);
    expect(erro.codigo).toBe(codigo);
    expect(erro.temporario).toBe(temporario);
  });

  it('valores que não são objeto viram "outro"', () => {
    expect(traduzirErroSmtp('texto').codigo).toBe('outro');
    expect(traduzirErroSmtp(null).codigo).toBe('outro');
  });

  it('CA-12: o erro novo não carrega nada do original (cause, command, response, message)', () => {
    const original = Object.assign(new Error(`falhou com ${SENHA}`), {
      code: 'EAUTH',
      command: `AUTH PLAIN ${SENHA_BASE64}`,
      response: `535 recusado ${SENHA_BASE64}`,
      responseCode: 535,
      permanent: true,
    });
    const traduzido = traduzirErroSmtp(original);
    expect(traduzido.cause).toBeUndefined();
    expect(Object.keys(traduzido).sort()).toEqual(['codigo', 'name', 'temporario']);
    semSegredos(serializarErro(traduzido));
  });
});

describe('criarEmailReal contra o stub SMTP (CA-11)', () => {
  it('CA-11: entrega com MAIL FROM = EMAIL_FROM, RCPT TO = destinatário, Subject e corpo, autenticado', async () => {
    porta = criarEmailReal(opcoes(stub));
    const resultado = await porta.enviar(MENSAGEM);

    expect(stub.mensagens).toHaveLength(1);
    const [recebida] = stub.mensagens;
    expect(recebida.mailFrom).toBe(REMETENTE);
    expect(recebida.rcptTo).toEqual([MENSAGEM.para]);
    expect(recebida.autenticacao).toEqual({ usuario: USUARIO, senha: SENHA });
    expect(recebida.dados).toMatch(/^Subject: Confirme seu cadastro$/m);
    expect(recebida.dados).toMatch(/^From: nao-responda@agenda\.test$/m);
    expect(recebida.dados).toMatch(/^To: cliente@exemplo\.com$/m);
    expect(recebida.dados).toContain(MENSAGEM.texto);
    expect(resultado.provedorId).toMatch(/^<.+>$/);
    expect(recebida.dados).toContain(`Message-ID: ${resultado.provedorId}`);
  });

  it('CA-11: EMAIL_FROM com nome usa só o endereço no envelope e mantém o nome no cabeçalho', async () => {
    porta = criarEmailReal({ ...opcoes(stub), remetente: 'Agenda Beleza <nao-responda@agenda.test>' });
    await porta.enviar(MENSAGEM);
    expect(stub.mensagens[0].mailFrom).toBe(REMETENTE);
    expect(stub.mensagens[0].dados).toMatch(/^From: Agenda Beleza <nao-responda@agenda\.test>$/m);
  });

  it('envia o html como alternativa quando informado (D-8)', async () => {
    porta = criarEmailReal(opcoes(stub));
    await porta.enviar({ ...MENSAGEM, html: '<p>Confirme <b>agora</b></p>' });
    const { dados } = stub.mensagens[0];
    expect(dados).toContain('multipart/alternative');
    expect(dados).toContain('<p>Confirme <b>agora</b></p>');
    expect(dados).toContain(MENSAGEM.texto);
  });

  it('sem autenticação configurada, envia sem AUTH', async () => {
    const aberto = await iniciarStubSmtp();
    try {
      porta = criarEmailReal({ ...opcoes(aberto), autenticacao: null });
      await porta.enviar(MENSAGEM);
      expect(aberto.mensagens).toHaveLength(1);
      expect(aberto.mensagens[0].autenticacao).toBeNull();
      expect(aberto.comandos.some((c) => c.startsWith('AUTH'))).toBe(false);
    } finally {
      porta?.fechar();
      porta = undefined;
      await aberto.fechar();
    }
  });

  it('com o padrão de produção (requireTLS), recusa autenticar num servidor sem STARTTLS', async () => {
    porta = criarEmailReal({ ...opcoes(stub), exigirTls: undefined });
    const erro = await falha(porta.enviar(MENSAGEM));
    expect(erro).toBeInstanceOf(ErroEnvioEmail);
    expect(stub.mensagens).toHaveLength(0);
    expect(stub.comandos.some((c) => c.startsWith('AUTH'))).toBe(false);
  });

  it('CA-11/CA-12: autenticação recusada → ErroEnvioEmail("autenticacao", permanente), sem segredo', async () => {
    stub.definirModo('recusarAuth');
    porta = criarEmailReal(opcoes(stub));
    const saida = capturarSaida();

    const erro = await falha(porta.enviar(MENSAGEM));

    expect(erro).toBeInstanceOf(ErroEnvioEmail);
    expect(erro).toMatchObject({ codigo: 'autenticacao', temporario: false });
    expect((erro as Error).cause).toBeUndefined();
    expect(stub.mensagens).toHaveLength(0);
    // O stub de fato recebeu (e ecoou) a credencial: a ausência abaixo não é por acaso.
    expect(stub.comandos.join('\n')).toContain(SENHA_BASE64);
    semSegredos(serializarErro(erro));
    semSegredos(saida());
  });

  it('CA-11/CA-12: destinatário recusado (550) → ErroEnvioEmail("recusado", permanente)', async () => {
    stub.definirModo('recusarRcpt');
    porta = criarEmailReal(opcoes(stub));
    const saida = capturarSaida();

    const erro = await falha(porta.enviar(MENSAGEM));

    expect(erro).toMatchObject({ codigo: 'recusado', temporario: false });
    expect(erro).toBeInstanceOf(ErroEnvioEmail);
    expect(stub.mensagens).toHaveLength(0);
    semSegredos(serializarErro(erro));
    semSegredos(saida());
  });

  it('destinatário adiado (451) → ErroEnvioEmail("recusado", temporário)', async () => {
    stub.definirModo('adiarRcpt');
    porta = criarEmailReal(opcoes(stub));
    const erro = await falha(porta.enviar(MENSAGEM));
    expect(erro).toMatchObject({ codigo: 'recusado', temporario: true });
  });

  it('CA-11/CA-12: porta fechada → ErroEnvioEmail("conexao", temporário) dentro do tempo-limite', async () => {
    porta = criarEmailReal(opcoes({ host: '127.0.0.1', porta: await portaFechada() }));
    const saida = capturarSaida();
    const inicio = performance.now();

    const erro = await falha(porta.enviar(MENSAGEM));

    expect(performance.now() - inicio).toBeLessThan(2000);
    expect(erro).toBeInstanceOf(ErroEnvioEmail);
    expect(erro).toMatchObject({ codigo: 'conexao', temporario: true });
    semSegredos(serializarErro(erro));
    semSegredos(saida());
  });

  it('CA-11/CA-12: servidor que não saúda → ErroEnvioEmail("conexao") dentro do tempo-limite', async () => {
    stub.definirModo('silencioso');
    porta = criarEmailReal(opcoes(stub));
    const saida = capturarSaida();
    const inicio = performance.now();

    const erro = await falha(porta.enviar(MENSAGEM));

    const decorrido = performance.now() - inicio;
    expect(decorrido).toBeGreaterThanOrEqual(TIMEOUTS_CURTOS.saudacao - 50);
    expect(decorrido).toBeLessThan(2000);
    expect(stub.conexoes()).toBe(1);
    expect(erro).toMatchObject({ codigo: 'conexao', temporario: true });
    semSegredos(serializarErro(erro));
    semSegredos(saida());
  });
});

describe('criarEmailReal: validação antes de qualquer efeito (CA-23, RN-9)', () => {
  it.each<[string, MensagemEmail, string]>([
    ['destinatário inválido', { ...MENSAGEM, para: 'nao-e-email' }, 'para'],
    ['vários destinatários', { ...MENSAGEM, para: 'a@exemplo.com, b@exemplo.com' }, 'para'],
    ['vários destinatários com ;', { ...MENSAGEM, para: 'a@exemplo.com;b@exemplo.com' }, 'para'],
    ['assunto com CR/LF', { ...MENSAGEM, assunto: 'Oi\r\nBcc: alvo@exemplo.com' }, 'assunto'],
    ['texto vazio', { ...MENSAGEM, texto: '' }, 'texto'],
  ])('CA-23: %s → ErroValidacaoEmail e o stub não recebe conexão nem mensagem', async (_caso, m, campo) => {
    porta = criarEmailReal(opcoes(stub));
    const erro = await falha(porta.enviar(m));
    expect(erro).toBeInstanceOf(ErroValidacaoEmail);
    expect((erro as ErroValidacaoEmail).campo).toBe(campo);
    expect(stub.conexoes()).toBe(0);
    expect(stub.mensagens).toHaveLength(0);
    expect(stub.comandos.some((c) => c.startsWith('MAIL FROM'))).toBe(false);
  });
});
