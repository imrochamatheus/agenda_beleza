import { describe, expect, it } from 'vitest';

import { descreverModos, executarCheckEnv } from './check-env';

const BASE = { DATABASE_URL: 'postgresql://agenda:senha-do-banco@h:5432/d' };
const SIMULADOS =
  'check-env: ambiente válido (adaptadores: armazenamento=simulado, email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado)';

function saidaGravada() {
  const linhas = { log: [] as string[], error: [] as string[] };
  return {
    linhas,
    saida: { log: (m: string) => linhas.log.push(m), error: (m: string) => linhas.error.push(m) },
  };
}

function executar(fonte: Record<string, string | undefined>) {
  const { linhas, saida } = saidaGravada();
  const codigo = executarCheckEnv({ ...BASE, ...fonte }, saida);
  return { codigo, ...linhas, tudo: [...linhas.log, ...linhas.error].join('\n') };
}

/** Variáveis citadas na linha de erro (depois dos dois-pontos da mensagem do ErroDeAmbiente). */
function nomeadas(linhaDeErro: string): string[] {
  return linhaDeErro.split('inválidas: ')[1].split(', ');
}

const EMAIL_REAL_OK = {
  EMAIL_ADAPTER: 'real',
  SMTP_HOST: 'smtp.exemplo.com',
  SMTP_PORT: '2525',
  SMTP_USER: 'usuario-smtp',
  SMTP_PASSWORD: 'senha-smtp-super-secreta',
  SMTP_SECURE: 'false',
  EMAIL_FROM: 'Agenda Beleza <nao-responda@exemplo.com>',
};
const TURNSTILE_REAL_OK = {
  TURNSTILE_ADAPTER: 'real',
  TURNSTILE_SITE_KEY: 'chave-publica-do-site',
  TURNSTILE_SECRET_KEY: 'segredo-do-turnstile',
};

describe('executarCheckEnv', () => {
  it('CA-1: devolve 0 e registra numa única linha os quatro modos simulados', () => {
    const r = executar({});
    expect(r.codigo).toBe(0);
    expect(r.log).toEqual([SIMULADOS]);
    expect(r.error).toEqual([]);
  });

  it('devolve 1 e nomeia a variável inválida sem imprimir o valor', () => {
    const r = executar({ APP_URL: 'segredo-nao-url' });
    expect(r.codigo).toBe(1);
    expect(r.log).toEqual([]);
    expect(r.error).toHaveLength(1);
    expect(r.error[0]).toContain('APP_URL');
    expect(r.error[0]).not.toContain('segredo-nao-url');
  });

  it('CA-2: EMAIL_ADAPTER=real sem SMTP_HOST devolve 1 e a saída de erro contém SMTP_HOST', () => {
    const r = executar({ ...EMAIL_REAL_OK, SMTP_HOST: '' });
    expect(r.codigo).toBe(1);
    expect(r.log).toEqual([]);
    expect(nomeadas(r.error[0])).toEqual(['SMTP_HOST']);
  });

  it.each(['MP_ADAPTER', 'WHATSAPP_ADAPTER'])('CA-9: %s=real devolve 1 nomeando o seletor (D-1)', (seletor) => {
    const r = executar({ [seletor]: 'real' });
    expect(r.codigo).toBe(1);
    expect(nomeadas(r.error[0])).toEqual([seletor]);
  });

  it.each([
    ['QUEUE_RETRY_LIMIT', '21'],
    ['QUEUE_RETRY_DELAY_SECONDS', '0'],
    ['QUEUE_RETRY_BACKOFF', 'sim'],
  ])('CA-11 (D-008): %s=%j devolve 1 nomeando só a variável, sem o valor', (variavel, valor) => {
    const r = executar({ [variavel]: valor });
    expect(r.codigo).toBe(1);
    expect(r.log).toEqual([]);
    expect(nomeadas(r.error[0])).toEqual([variavel]);
    expect(r.error[0]).not.toContain(valor);
  });

  describe('CA-8: combinações do modo real', () => {
    const casos: Array<[string, Record<string, string>, string[]]> = [
      [
        'TURNSTILE_ADAPTER=real sem as duas chaves',
        { TURNSTILE_ADAPTER: 'real', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' },
        ['TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY'],
      ],
      [
        'EMAIL_ADAPTER=real sem SMTP_HOST e sem EMAIL_FROM',
        { ...EMAIL_REAL_OK, SMTP_HOST: '', EMAIL_FROM: '' },
        ['EMAIL_FROM', 'SMTP_HOST'],
      ],
      ['SMTP_PORT=abc', { ...EMAIL_REAL_OK, SMTP_PORT: 'abc' }, ['SMTP_PORT']],
      ['SMTP_PORT=70000', { ...EMAIL_REAL_OK, SMTP_PORT: '70000' }, ['SMTP_PORT']],
      ['SMTP_SECURE=talvez', { ...EMAIL_REAL_OK, SMTP_SECURE: 'talvez' }, ['SMTP_SECURE']],
      ['SMTP_USER sem SMTP_PASSWORD', { ...EMAIL_REAL_OK, SMTP_PASSWORD: '' }, ['SMTP_PASSWORD']],
      [
        'EMAIL_FROM inválido',
        { ...EMAIL_REAL_OK, EMAIL_FROM: 'remetente-invalido@' },
        ['EMAIL_FROM'],
      ],
    ];

    it.each(casos)('CA-8: %s → 1 e nomeia exatamente as variáveis esperadas', (_nome, fonte, esperadas) => {
      const r = executar(fonte);
      expect(r.codigo).toBe(1);
      expect(r.log).toEqual([]);
      expect(r.error).toHaveLength(1);
      expect(nomeadas(r.error[0])).toEqual(esperadas);
    });

    it.each(casos)('CA-8: %s → nenhum valor aparece na saída', (_nome, fonte) => {
      const r = executar(fonte);
      const valores = [...Object.values({ ...BASE, ...fonte })].filter(
        (v) => v !== '' && v !== 'real' && v !== 'false',
      );
      for (const valor of valores) expect(r.tudo, valor).not.toContain(valor);
    });

    it('CA-8: todas as exigências satisfeitas → 0, com e-mail e Turnstile reais e nenhum valor na saída', () => {
      const r = executar({ ...EMAIL_REAL_OK, ...TURNSTILE_REAL_OK });
      expect(r.codigo).toBe(0);
      expect(r.error).toEqual([]);
      expect(r.log).toEqual([
        'check-env: ambiente válido (adaptadores: armazenamento=simulado, email=real, mp=simulado, turnstile=real, whatsapp=simulado)',
      ]);
      for (const valor of [
        'senha-smtp-super-secreta',
        'usuario-smtp',
        'smtp.exemplo.com',
        'segredo-do-turnstile',
        'chave-publica-do-site',
        'senha-do-banco',
      ]) {
        expect(r.tudo).not.toContain(valor);
      }
    });

    it('CA-8: seletores simulado com SMTP_PORT=abc e as chaves vazias → 0', () => {
      const r = executar({
        EMAIL_ADAPTER: 'simulado',
        WHATSAPP_ADAPTER: 'simulado',
        MP_ADAPTER: 'simulado',
        TURNSTILE_ADAPTER: 'simulado',
        SMTP_PORT: 'abc',
        SMTP_HOST: '',
        SMTP_USER: '',
        SMTP_PASSWORD: '',
        SMTP_SECURE: '',
        EMAIL_FROM: '',
        TURNSTILE_SITE_KEY: '',
        TURNSTILE_SECRET_KEY: '',
      });
      expect(r.codigo).toBe(0);
      expect(r.log).toEqual([SIMULADOS]);
    });
  });
});

describe('descreverModos', () => {
  it('lista os cinco modos na ordem armazenamento, email, mp, turnstile, whatsapp', () => {
    expect(
      descreverModos({ armazenamento: 'simulado', email: 'real', mercadoPago: 'simulado', turnstile: 'real', whatsapp: 'simulado' }),
    ).toBe('armazenamento=simulado, email=real, mp=simulado, turnstile=real, whatsapp=simulado');
  });
});
