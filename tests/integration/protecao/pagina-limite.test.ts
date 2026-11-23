import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import PaginaPublicaDoSalao from '@/app/(publico)/[slug]/page';
import { carregarPassoComLimite, carregarSalao, lerRegrasDaPagina } from '@/server/reserva-publica/pagina';
import { chaveDeData, lerPasso, valorDoItem } from '@/server/reserva-publica/passos';
import type { ParametrosBrutos } from '@/server/reserva-publica/passos';
import { criarPublicoContext } from '@/server/tenant/context';

import { AGORA, DIA, criarCenarioReserva, sp } from '../../support/reservas';
import { ipNovo } from '../../support/reserva-publica';
import { instalarContadorDeComandos } from '../../support/reservas';
import { contadorDoIp } from './apoio';

// D-027 CA-8 e CA-14: a consulta de horários por IP e a página com query, sem cálculo quando limitada.
// D-050: a query passa a `s`, `data` e `h<k>` (sem `p`); o passo calculado é o do serviço.

const { ipDaRequisicao } = vi.hoisted(() => ({ ipDaRequisicao: { valor: '192.0.2.1' } }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': ipDaRequisicao.valor }),
}));

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => {
  vi.restoreAllMocks();
});

const DIA_CHAVE = chaveDeData(DIA);

describe('carregarPassoComLimite (CA-8, CA-14)', () => {
  it('M consultas passam; a M+1 devolve "limitado" com UM único comando SQL (o contador), sem calcular', async () => {
    const c = await criarCenarioReserva();
    const ctx = criarPublicoContext(c.s.salaoId, c.s.slugAtual);
    const salao = await carregarSalao(ctx, AGORA);
    const regras = await lerRegrasDaPagina(ctx, AGORA);
    const ip = ipNovo();
    const params: ParametrosBrutos = { s: c.A, data: DIA_CHAVE };
    const ler = () => carregarPassoComLimite(ctx, lerPasso(params, regras), { servicos: salao.servicos, equipe: salao.equipe, regras, agora: AGORA, ip });

    vi.stubEnv('PROTECAO_LIMITE_IP_DISPONIBILIDADE', '3');
    for (let i = 0; i < 3; i++) expect((await ler()).passo).toBe('servico');
    const contador = instalarContadorDeComandos();
    try {
      expect(await ler()).toEqual({ passo: 'limitado' });
      expect(contador.contar()).toBe(1);
    } finally {
      await contador.encerrar();
    }
    expect(await contadorDoIp(ip, 'disponibilidade')).toBe(4);
  });

  it('D-051 (CA-14): o passo "dia" e a navegação de semana consomem UMA cota cada; limitado não calcula a régua', async () => {
    const c = await criarCenarioReserva();
    const ctx = criarPublicoContext(c.s.salaoId, c.s.slugAtual);
    const salao = await carregarSalao(ctx, AGORA);
    const regras = await lerRegrasDaPagina(ctx, AGORA);
    const ip = ipNovo();
    const ler = (params: ParametrosBrutos) =>
      carregarPassoComLimite(ctx, lerPasso(params, regras), { servicos: salao.servicos, equipe: salao.equipe, regras, agora: AGORA, ip });
    vi.stubEnv('PROTECAO_LIMITE_IP_DISPONIBILIDADE', '2');
    expect((await ler({ s: c.A })).passo).toBe('dia');
    expect(await contadorDoIp(ip, 'disponibilidade')).toBe(1);
    expect((await ler({ s: c.A, de: '2026-11-27' })).passo).toBe('dia');
    expect(await contadorDoIp(ip, 'disponibilidade')).toBe(2);
    const contador = instalarContadorDeComandos();
    try {
      expect(await ler({ s: c.A, de: '2026-12-04' })).toEqual({ passo: 'limitado' });
      expect(contador.contar()).toBe(1);
    } finally {
      await contador.encerrar();
    }
    expect(await contadorDoIp(ip, 'disponibilidade')).toBe(3);
  });

  it('o passo de serviços (inclusive "Alterar serviços") não consome cota', async () => {
    const c = await criarCenarioReserva();
    const ctx = criarPublicoContext(c.s.salaoId, c.s.slugAtual);
    const salao = await carregarSalao(ctx, AGORA);
    const regras = await lerRegrasDaPagina(ctx, AGORA);
    const ip = ipNovo();
    for (const params of [{}, { s: c.A, alterar: 'servicos' }] as ParametrosBrutos[]) {
      await carregarPassoComLimite(ctx, lerPasso(params, regras), { servicos: salao.servicos, equipe: salao.equipe, regras, agora: AGORA, ip });
    }
    expect(await contadorDoIp(ip, 'disponibilidade')).toBe(0);
  });

  it('IPs diferentes têm contadores diferentes', async () => {
    const c = await criarCenarioReserva();
    const ctx = criarPublicoContext(c.s.salaoId, c.s.slugAtual);
    const salao = await carregarSalao(ctx, AGORA);
    const regras = await lerRegrasDaPagina(ctx, AGORA);
    vi.stubEnv('PROTECAO_LIMITE_IP_DISPONIBILIDADE', '1');
    const ler = (ip: string) =>
      carregarPassoComLimite(ctx, lerPasso({ s: c.A, data: DIA_CHAVE }, regras), { servicos: salao.servicos, equipe: salao.equipe, regras, agora: AGORA, ip });
    const a = ipNovo();
    expect((await ler(a)).passo).toBe('servico');
    expect((await ler(a)).passo).toBe('limitado');
    expect((await ler(ipNovo())).passo).toBe('servico');
  });
});

describe('página com query limitada (CA-14)', () => {
  async function html(slug: string, params: ParametrosBrutos): Promise<string> {
    const el = await PaginaPublicaDoSalao({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(params) });
    return renderToStaticMarkup(el);
  }

  it('mostra o aviso em pt-BR e nenhum horário; sem JS idem (HTML estático)', async () => {
    const c = await criarCenarioReserva();
    vi.stubEnv('PROTECAO_LIMITE_IP_DISPONIBILIDADE', '1');
    ipDaRequisicao.valor = ipNovo();
    const params = { s: c.A, data: DIA_CHAVE };
    const primeira = await html(c.s.slugAtual, params);
    expect(primeira).toContain('name="h0"');
    expect(primeira).toContain(valorDoItem(c.ana, sp(DIA, '09:00')));
    const segunda = await html(c.s.slugAtual, params);
    expect(segunda).toContain('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    expect(segunda).not.toContain('name="h0"');
    expect(segunda).not.toContain(sp(DIA, '09:00').toISOString());
    // D-051: sem régua nem horários quando limitado.
    expect(segunda).not.toContain('Escolha o dia');
    expect(primeira).toContain('Escolha o dia');
  });

  it('o passo "dados" entrega o campo cf-turnstile-response com o token simulado', async () => {
    const c = await criarCenarioReserva();
    ipDaRequisicao.valor = ipNovo();
    const pagina = await html(c.s.slugAtual, { s: c.A, data: DIA_CHAVE, h0: valorDoItem(c.ana, sp(DIA, '10:00')) });
    expect(pagina).toMatch(/<input type="hidden" name="cf-turnstile-response" value="XXXX\.DUMMY\.TOKEN\.XXXX"\/>/);
  });
});
