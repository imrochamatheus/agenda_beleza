import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroDeAmbiente } from '@/server/env';

import { criarEmailReal } from './email/real';
import { criarEmailSimulado } from './email/simulado';
import { criarMercadoPagoReal } from './mercadopago/real';
import { criarMercadoPagoSimulado } from './mercadopago/simulado';
import { NaoImplementado } from './nao-implementado';
import {
  criarIntegracoes,
  integracoes,
  redefinirIntegracoes,
  selecionarEmail,
  selecionarMercadoPago,
  selecionarTurnstile,
  selecionarWhatsApp,
} from './registry';
import { criarTurnstileReal } from './turnstile/real';
import {
  CHAVE_SITE_TURNSTILE_SIMULADA,
  criarTurnstileSimulado,
  TOKEN_TURNSTILE_SIMULADO,
} from './turnstile/simulado';
import { criarWhatsAppReal } from './whatsapp/real';
import { criarWhatsAppSimulado } from './whatsapp/simulado';

// Registro (RN-14, D-007 §3.11): CA-1, CA-9 (seleção), CA-10 e CA-14 (pela porta do registro).
// Sem banco: construir os simulados não conecta (obterPrisma é preguiçoso; R-12) e nenhum teste
// aqui chama uma operação que grave. As fábricas são ESPIONADAS (o original continua rodando) só
// para provar QUAL adaptador o registro construiu e com quais argumentos.

vi.mock('./email/simulado', async (original) => {
  const m = await original<typeof import('./email/simulado')>();
  return { ...m, criarEmailSimulado: vi.fn(m.criarEmailSimulado) };
});
vi.mock('./email/real', async (original) => {
  const m = await original<typeof import('./email/real')>();
  return { ...m, criarEmailReal: vi.fn(m.criarEmailReal) };
});
vi.mock('./mercadopago/simulado', async (original) => {
  const m = await original<typeof import('./mercadopago/simulado')>();
  return { ...m, criarMercadoPagoSimulado: vi.fn(m.criarMercadoPagoSimulado) };
});
vi.mock('./mercadopago/real', async (original) => {
  const m = await original<typeof import('./mercadopago/real')>();
  return { ...m, criarMercadoPagoReal: vi.fn(m.criarMercadoPagoReal) };
});
vi.mock('./turnstile/simulado', async (original) => {
  const m = await original<typeof import('./turnstile/simulado')>();
  return { ...m, criarTurnstileSimulado: vi.fn(m.criarTurnstileSimulado) };
});
vi.mock('./turnstile/real', async (original) => {
  const m = await original<typeof import('./turnstile/real')>();
  return { ...m, criarTurnstileReal: vi.fn(m.criarTurnstileReal) };
});
vi.mock('./whatsapp/simulado', async (original) => {
  const m = await original<typeof import('./whatsapp/simulado')>();
  return { ...m, criarWhatsAppSimulado: vi.fn(m.criarWhatsAppSimulado) };
});
vi.mock('./whatsapp/real', async (original) => {
  const m = await original<typeof import('./whatsapp/real')>();
  return { ...m, criarWhatsAppReal: vi.fn(m.criarWhatsAppReal) };
});

const caminhoExemplo = fileURLToPath(new URL('../../../.env.example', import.meta.url));
const exemplo = parseEnv(readFileSync(caminhoExemplo, 'utf8')) as Record<string, string>;

const URL_BANCO = 'postgresql://agenda:segredo123@localhost:5432/agenda_beleza';
const SEGREDO = 'segredo-turnstile-do-teste-0x1234';

/** Instância devolvida pela última chamada da fábrica espionada. */
function ultimaInstancia(f: unknown): unknown {
  const resultados = vi.mocked(f as (...a: unknown[]) => unknown).mock.results;
  return resultados.at(-1)?.value;
}

/** Remove TODAS as variáveis do processo (restauradas por unstubAllEnvs). */
function esvaziarAmbiente(): void {
  for (const chave of Object.keys(process.env)) vi.stubEnv(chave, undefined);
}

function erroDe(f: () => unknown): Error & { variaveis?: string[] } {
  try {
    f();
  } catch (erro) {
    return erro as Error & { variaveis?: string[] };
  }
  throw new Error('deveria ter lançado');
}

beforeEach(() => {
  vi.clearAllMocks();
  redefinirIntegracoes();
});
afterEach(() => {
  vi.unstubAllEnvs();
  redefinirIntegracoes();
});

describe('CA-1: .env.example sem alterações → quatro simulados', () => {
  it('CA-1: modos "simulado" e cada porta é a instância construída pela fábrica do simulado', async () => {
    const r = criarIntegracoes(exemplo);

    expect(r.modos).toEqual({
      email: 'simulado',
      whatsapp: 'simulado',
      mercadoPago: 'simulado',
      turnstile: 'simulado',
    });
    expect(r.email).toBe(ultimaInstancia(criarEmailSimulado));
    expect(r.whatsapp).toBe(ultimaInstancia(criarWhatsAppSimulado));
    expect(r.mercadoPago).toBe(ultimaInstancia(criarMercadoPagoSimulado));
    expect(r.turnstile).toBe(ultimaInstancia(criarTurnstileSimulado));
    // Os simulados de e-mail e WhatsApp usam o cliente padrão; o MP recebe o APP_URL validado.
    expect(criarEmailSimulado).toHaveBeenCalledWith();
    expect(criarWhatsAppSimulado).toHaveBeenCalledWith();
    expect(criarMercadoPagoSimulado).toHaveBeenCalledWith({ appUrl: 'http://localhost:3000' });
    for (const real of [criarEmailReal, criarWhatsAppReal, criarMercadoPagoReal, criarTurnstileReal]) {
      expect(real).not.toHaveBeenCalled();
    }
    expect(r.turnstile.chaveDoSite()).toBe(CHAVE_SITE_TURNSTILE_SIMULADA);
    await expect(r.turnstile.validar({ token: TOKEN_TURNSTILE_SIMULADO })).resolves.toEqual({ valido: true });
  });

  it('CA-1: integracoes() sobre o process.env do .env.example dá os quatro simulados', () => {
    esvaziarAmbiente();
    for (const [chave, valor] of Object.entries(exemplo)) vi.stubEnv(chave, valor);

    expect(integracoes().modos).toEqual({
      email: 'simulado',
      whatsapp: 'simulado',
      mercadoPago: 'simulado',
      turnstile: 'simulado',
    });
  });

  it('repassa um APP_URL próprio ao MP simulado', () => {
    criarIntegracoes({ DATABASE_URL: URL_BANCO, APP_URL: 'https://agenda.exemplo.com.br' });
    expect(criarMercadoPagoSimulado).toHaveBeenCalledWith({ appUrl: 'https://agenda.exemplo.com.br' });
  });
});

describe('CA-9: seleção "real" do MP e do WhatsApp liga os stubs NaoImplementado', () => {
  it('CA-9: selecionarMercadoPago("real") é a instância de mercadopago/real.ts e todo método rejeita (E6.6)', async () => {
    const porta = selecionarMercadoPago('real', { appUrl: 'http://localhost:3000' });

    expect(porta).toBe(ultimaInstancia(criarMercadoPagoReal));
    expect(criarMercadoPagoSimulado).not.toHaveBeenCalled();
    const chamadas = [
      porta.criarAssinatura({
        salaoId: '00000000-0000-4000-8000-000000000000',
        emailPagador: 'gestora@exemplo.com.br',
        urlRetorno: 'http://localhost:3000/retorno',
      }),
      porta.consultarAssinatura('x'),
      porta.consultarPagamento('x'),
      porta.cancelarAssinatura('x'),
      porta.adiarProximaCobranca('x', new Date()),
      porta.validarWebhook({ cabecalhos: {}, consulta: {}, corpo: {} }),
    ];
    expect(chamadas).toHaveLength(Object.keys(porta).length);
    const resultados = await Promise.allSettled(chamadas);
    for (const r of resultados) {
      expect(r.status).toBe('rejected');
      const erro = (r as PromiseRejectedResult).reason as unknown;
      expect(erro).toBeInstanceOf(NaoImplementado);
      expect((erro as Error).message).toContain('E6.6');
    }
  });

  it('CA-9: selecionarWhatsApp("real") é a instância de whatsapp/real.ts e enviarModelo rejeita (E7.2)', async () => {
    const porta = selecionarWhatsApp('real');

    expect(porta).toBe(ultimaInstancia(criarWhatsAppReal));
    expect(criarWhatsAppSimulado).not.toHaveBeenCalled();
    expect(Object.keys(porta)).toEqual(['enviarModelo']);
    const envio = porta.enviarModelo({
      destinatarioE164: '+5511987654321',
      modelo: 'confirmacao',
      parametros: {},
      chaveIdempotencia: 'r:confirmacao:1',
    });
    await expect(envio).rejects.toBeInstanceOf(NaoImplementado);
    await expect(envio).rejects.toThrow('E7.2');
  });

  it('CA-9: seleção "simulado" liga os simulados', () => {
    expect(selecionarMercadoPago('simulado', { appUrl: 'http://localhost:3000' })).toBe(
      ultimaInstancia(criarMercadoPagoSimulado),
    );
    expect(selecionarWhatsApp('simulado')).toBe(ultimaInstancia(criarWhatsAppSimulado));
    expect(criarMercadoPagoReal).not.toHaveBeenCalled();
    expect(criarWhatsAppReal).not.toHaveBeenCalled();
  });

  it('D-1: o registro recusa MP_ADAPTER=real e WHATSAPP_ADAPTER=real nomeando os seletores, sem construir nada', () => {
    const erro = erroDe(() =>
      criarIntegracoes({ DATABASE_URL: URL_BANCO, MP_ADAPTER: 'real', WHATSAPP_ADAPTER: 'real' }),
    );
    expect(erro).toBeInstanceOf(ErroDeAmbiente);
    expect(erro.variaveis).toEqual(['MP_ADAPTER', 'WHATSAPP_ADAPTER']);
    expect(criarMercadoPagoReal).not.toHaveBeenCalled();
    expect(criarWhatsAppReal).not.toHaveBeenCalled();
  });
});

describe('selecionarEmail', () => {
  const config = {
    host: 'smtp.exemplo.com.br',
    porta: 587,
    seguro: false,
    autenticacao: { usuario: 'agenda', senha: 'senha-smtp' },
    remetente: 'Agenda Beleza <nao-responda@exemplo.com.br>',
  };

  it('"real" entrega ao criarEmailReal exatamente a ConfigSmtp, sem exigirTls (padrão de produção)', () => {
    const porta = selecionarEmail({ modo: 'real', config });

    expect(porta).toBe(ultimaInstancia(criarEmailReal));
    expect(criarEmailReal).toHaveBeenCalledWith(config);
    expect(vi.mocked(criarEmailReal).mock.calls[0][0]).not.toHaveProperty('exigirTls');
    expect(criarEmailSimulado).not.toHaveBeenCalled();
  });

  it('o registro monta a ConfigSmtp a partir do ambiente (EMAIL_ADAPTER=real)', () => {
    const r = criarIntegracoes({
      DATABASE_URL: URL_BANCO,
      EMAIL_ADAPTER: 'real',
      SMTP_HOST: 'smtp.exemplo.com.br',
      SMTP_USER: 'agenda',
      SMTP_PASSWORD: 'senha-smtp',
      EMAIL_FROM: 'Agenda Beleza <nao-responda@exemplo.com.br>',
    });

    expect(r.modos.email).toBe('real');
    expect(r.email).toBe(ultimaInstancia(criarEmailReal));
    expect(criarEmailReal).toHaveBeenCalledWith(config);
  });
});

describe('CA-10: o import não valida; o primeiro uso valida', () => {
  it('CA-10: importar o registro, as portas e os adaptadores num processo sem ambiente não lança', async () => {
    esvaziarAmbiente();
    vi.resetModules();

    const registro = await import('./registry');
    const modulos = [
      import('./email/port'),
      import('./email/real'),
      import('./email/simulado'),
      import('./turnstile/port'),
      import('./turnstile/real'),
      import('./turnstile/simulado'),
      import('./mercadopago/port'),
      import('./mercadopago/real'),
      import('./mercadopago/simulado'),
      import('./mercadopago/checkout-simulado'),
      import('./whatsapp/port'),
      import('./whatsapp/real'),
      import('./whatsapp/simulado'),
    ];
    const carregados = await Promise.all(modulos);
    expect(carregados).toHaveLength(13);
    // Nenhuma fábrica foi chamada só por importar.
    for (const f of [criarEmailSimulado, criarEmailReal, criarMercadoPagoSimulado, criarTurnstileReal]) {
      expect(f).not.toHaveBeenCalled();
    }

    // Primeiro uso, sem nenhuma variável: só DATABASE_URL é obrigatória na base.
    const erro = erroDe(() => registro.integracoes());
    expect(erro.name).toBe('ErroDeAmbiente');
    expect(erro.variaveis).toEqual(['DATABASE_URL']);
  });

  it('CA-10: EMAIL_ADAPTER=real sem SMTP_HOST → ErroDeAmbiente nomeando SMTP_HOST no primeiro uso, sem valores', () => {
    esvaziarAmbiente();
    vi.stubEnv('DATABASE_URL', URL_BANCO);
    vi.stubEnv('EMAIL_ADAPTER', 'real');
    vi.stubEnv('EMAIL_FROM', 'nao-responda@exemplo.com.br');

    const erro = erroDe(() => integracoes().email);
    expect(erro).toBeInstanceOf(ErroDeAmbiente);
    expect(erro.variaveis).toEqual(['SMTP_HOST']);
    expect(erro.message).toContain('SMTP_HOST');
    expect(erro.message).not.toContain('segredo123');
    expect(criarEmailReal).not.toHaveBeenCalled();

    // Sem memoização do erro: corrigido o ambiente, a chamada seguinte constrói o real.
    vi.stubEnv('SMTP_HOST', 'smtp.exemplo.com.br');
    expect(integracoes().modos.email).toBe('real');
    expect(integracoes().email).toBe(ultimaInstancia(criarEmailReal));
  });

  it('integracoes() memoiza; redefinirIntegracoes() descarta', () => {
    esvaziarAmbiente();
    vi.stubEnv('DATABASE_URL', URL_BANCO);

    const primeira = integracoes();
    expect(integracoes()).toBe(primeira);
    expect(criarEmailSimulado).toHaveBeenCalledTimes(1);

    redefinirIntegracoes();
    expect(integracoes()).not.toBe(primeira);
    expect(criarEmailSimulado).toHaveBeenCalledTimes(2);
  });
});

describe('CA-14: chave do site do Turnstile lida em runtime, pela porta do registro', () => {
  it('CA-14: integracoes() com TURNSTILE_ADAPTER=real devolve o valor vigente de TURNSTILE_SITE_KEY a cada chamada', () => {
    esvaziarAmbiente();
    vi.stubEnv('DATABASE_URL', URL_BANCO);
    vi.stubEnv('TURNSTILE_ADAPTER', 'real');
    vi.stubEnv('TURNSTILE_SECRET_KEY', SEGREDO);
    vi.stubEnv('TURNSTILE_SITE_KEY', '0x4AAAAAAAchave-1');

    const turnstile = integracoes().turnstile;
    expect(turnstile).toBe(ultimaInstancia(criarTurnstileReal));
    expect(turnstile.chaveDoSite()).toBe('0x4AAAAAAAchave-1');

    vi.stubEnv('TURNSTILE_SITE_KEY', '0x4AAAAAAAchave-2');
    expect(integracoes().turnstile).toBe(turnstile);
    expect(turnstile.chaveDoSite()).toBe('0x4AAAAAAAchave-2');
  });

  it('CA-14: o real recebe o segredo validado e a URL padrão (nenhuma URL de teste)', () => {
    criarIntegracoes({
      DATABASE_URL: URL_BANCO,
      TURNSTILE_ADAPTER: 'real',
      TURNSTILE_SECRET_KEY: SEGREDO,
      TURNSTILE_SITE_KEY: 'chave',
    });
    const opcoes = vi.mocked(criarTurnstileReal).mock.calls[0][0];
    expect(opcoes.segredo).toBe(SEGREDO);
    expect(opcoes).not.toHaveProperty('urlSiteverify');
    expect(opcoes).not.toHaveProperty('fetch');
  });

  it('CA-14: TURNSTILE_SITE_KEY esvaziada depois da inicialização → ErroDeAmbiente só com o nome', () => {
    const fonte: Record<string, string | undefined> = {
      DATABASE_URL: URL_BANCO,
      TURNSTILE_ADAPTER: 'real',
      TURNSTILE_SECRET_KEY: SEGREDO,
      TURNSTILE_SITE_KEY: 'chave-a',
    };
    const { turnstile } = criarIntegracoes(fonte);
    expect(turnstile.chaveDoSite()).toBe('chave-a');

    fonte.TURNSTILE_SITE_KEY = '';
    const vazia = erroDe(() => turnstile.chaveDoSite());
    expect(vazia).toBeInstanceOf(ErroDeAmbiente);
    expect(vazia.variaveis).toEqual(['TURNSTILE_SITE_KEY']);
    expect(vazia.message).not.toContain(SEGREDO);

    delete fonte.TURNSTILE_SITE_KEY;
    expect(erroDe(() => turnstile.chaveDoSite()).variaveis).toEqual(['TURNSTILE_SITE_KEY']);
  });

  it('CA-14: selecionarTurnstile lê process.env por padrão; no simulado devolve a chave documentada', () => {
    const real = selecionarTurnstile({ modo: 'real', config: { segredo: SEGREDO } });
    vi.stubEnv('TURNSTILE_SITE_KEY', 'k1');
    expect(real.chaveDoSite()).toBe('k1');
    vi.stubEnv('TURNSTILE_SITE_KEY', 'k2');
    expect(real.chaveDoSite()).toBe('k2');

    const simulado = selecionarTurnstile({ modo: 'simulado' });
    vi.stubEnv('TURNSTILE_SITE_KEY', 'ignorada');
    expect(simulado).toBe(ultimaInstancia(criarTurnstileSimulado));
    expect(simulado.chaveDoSite()).toBe(CHAVE_SITE_TURNSTILE_SIMULADA);
  });
});
