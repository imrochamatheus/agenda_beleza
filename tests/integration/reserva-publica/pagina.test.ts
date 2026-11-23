import { randomUUID } from 'node:crypto';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PaginaPublicaDoSalao, { generateMetadata } from '@/app/(publico)/[slug]/page';
import { chaveDeData, valorDoItem } from '@/server/reserva-publica/passos';
import type { ParametrosBrutos } from '@/server/reserva-publica/passos';
import { obterPrisma } from '@/server/repos/db';
import { resolverSalaoPorSlug } from '@/server/repos/publico';

import { AGORA, DIA, criarCenarioReserva, definirFuncionamento, sp } from '../../support/reservas';
import { definirAssinatura } from '../../support/reserva-publica';
import type { CenarioReserva } from '../../support/reservas';


// D-027: a ação e a página leem o IP em `headers()`; fora de uma requisição o Next lança. O IP vem de
// `x-forwarded-for` (TRUSTED_PROXY_HOPS=1) e muda a cada leitura, para os limites não vazarem entre casos.
const { proximoIp } = vi.hoisted(() => {
  let n = 0;
  return { proximoIp: () => `192.0.2.${(++n % 250) + 1}` };
});
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': proximoIp() }),
}));

// D-026 T-3: CA-1, CA-2, CA-3, CA-4 (página) e CA-13 contra o PostgreSQL real. A página é a função real da
// rota, chamada com `params`/`searchParams` e renderizada para HTML estático. D-050: a query passa a `s`,
// `data` e `h<k>`; os passos no servidor estão em `passos.test.ts` e `fluxo-itens.test.ts`.

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

const db = () => obterPrisma();
const DIA_CHAVE = chaveDeData(DIA);

async function html(slug: string, params: ParametrosBrutos = {}): Promise<string> {
  const el = await PaginaPublicaDoSalao({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(el);
}
const digest = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return String((e as { digest?: unknown }).digest);
  }
  throw new Error('esperava uma exceção do Next');
};

async function perfilCompleto(c: CenarioReserva): Promise<void> {
  const salaoId = c.s.salaoId;
  await db().salao.update({
    where: { id: salaoId },
    data: {
      nome: 'Studio Bela',
      descricao: 'Cuidado <b>com</b> carinho.',
      enderecoLogradouro: 'Rua A',
      enderecoNumero: '10',
      enderecoBairro: 'Centro',
      enderecoCidade: 'São Paulo',
      enderecoUf: 'SP',
      enderecoCep: '01304001',
      telefoneE164: '+551134567890',
      instagram: 'studiobela',
      meiosPagamento: ['pix'],
      comodidades: ['wifi'],
    },
  });
  await definirFuncionamento(salaoId, { 1: [['09:00', '18:00']] });
  await db().salaoFoto.create({
    data: { salaoId, chave: `fotos/${randomUUID()}.webp`, alt: 'Recepção do salão', posicao: 1, largura: 800, altura: 600, bytes: 1000, envio: randomUUID() },
  });
}

describe('CA-1: perfil completo', () => {
  it('mostra h1, fotos, serviços, equipe e todas as seções, e nada de dados internos', async () => {
    const c = await criarCenarioReserva();
    await perfilCompleto(c);
    const h = await html(c.s.slugAtual);
    expect(h).toContain('<h1>Studio Bela</h1>');
    for (const t of ['Serviços', 'Equipe', 'Horário de funcionamento', 'Endereço', 'Contato', 'Formas de pagamento', 'Comodidades']) {
      expect(h, t).toMatch(new RegExp(`<h2[^>]*>${t}</h2>`));
    }
    expect(h).toContain('alt="Recepção do salão"');
    expect(h).toContain('Ana');
    expect(h).toContain('Cuidado &lt;b&gt;com&lt;/b&gt; carinho.');
    expect(h).not.toContain('<b>com</b>');
    expect(h).toContain('09:00–18:00');
    expect(h).toContain('(11) 3456-7890');
    // Só serviços ativos com profissional ativo; nunca o inativo nem o e-mail do gestor.
    expect(h).not.toContain('descontinuada');
    expect(h).not.toContain(c.s.gestor.email);
    expect(h).not.toContain(c.s.gestor.usuarioId);
  });

  it('metadados com o nome do salão; slug inválido ou histórico sem metadados', async () => {
    const c = await criarCenarioReserva();
    await db().salao.update({ where: { id: c.s.salaoId }, data: { nome: 'Studio Bela' } });
    expect(await generateMetadata({ params: Promise.resolve({ slug: c.s.slugAtual }) })).toMatchObject({ title: 'Studio Bela · Agende online' });
    expect(await generateMetadata({ params: Promise.resolve({ slug: c.s.slugHistorico }) })).toEqual({});
    expect(await generateMetadata({ params: Promise.resolve({ slug: 'Maiuscula' }) })).toEqual({});
    expect(await generateMetadata({ params: Promise.resolve({ slug: 'inexistente-xyz' }) })).toEqual({});
  });
});

describe('CA-2: perfil sem campos opcionais', () => {
  it('seções vazias omitidas, sem "undefined"/"null", e o fluxo de serviços presente', async () => {
    const c = await criarCenarioReserva();
    const h = await html(c.s.slugAtual);
    for (const t of ['Horário de funcionamento', 'Endereço', 'Contato', 'Formas de pagamento', 'Comodidades']) {
      expect(h, t).not.toContain(`>${t}</h2>`);
    }
    expect(h).not.toMatch(/undefined|>null<|\bnull\b/);
    expect(h).toContain('name="s"');
    expect(h).toContain('>Equipe</h2>');
  });
});

describe('CA-3: slug', () => {
  it('histórico: 308 para o slug atual, preservando a query', async () => {
    const c = await criarCenarioReserva();
    const h0 = valorDoItem(c.ana, sp(DIA, '10:00'));
    const d = await digest(html(c.s.slugHistorico, { s: [c.A, c.B], data: DIA_CHAVE, h0 }));
    expect(d).toBe(`NEXT_REDIRECT;replace;/${c.s.slugAtual}?s=${c.A}&s=${c.B}&data=${DIA_CHAVE}&h0=${encodeURIComponent(h0)};308;`);
    expect(await digest(html(c.s.slugHistorico))).toBe(`NEXT_REDIRECT;replace;/${c.s.slugAtual};308;`);
  });

  it('inexistente, maiúsculas, caracteres especiais, longo e reservados: 404', async () => {
    for (const slug of ['nao-existe-xyz', 'Maiusculas', 'a b', 'ação', 'x'.repeat(200), 'api', 'painel', 'dev', 'termos']) {
      expect(await digest(html(slug)), slug).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    }
  });

  it('o repositório não resolve nenhum segmento reservado como salão', async () => {
    const { SEGMENTOS_RESERVADOS } = await import('@/config/navegacao');
    for (const segmento of SEGMENTOS_RESERVADOS) {
      await expect(resolverSalaoPorSlug(segmento), segmento).rejects.toMatchObject({ name: 'NaoEncontrado' });
    }
  });
});

describe('CA-4: salão indisponível (página)', () => {
  const casos: [string, (c: CenarioReserva) => Promise<unknown>][] = [
    ['suspenso manual', (c) => db().salao.update({ where: { id: c.s.salaoId }, data: { suspensoManualEm: AGORA } })],
    ['assinatura pendente', (c) => definirAssinatura(c.s.salaoId, 'pendente')],
    ['assinatura suspensa', (c) => definirAssinatura(c.s.salaoId, 'suspensa')],
    ['sem serviço ofertável', (c) => db().servico.updateMany({ where: { salaoId: c.s.salaoId }, data: { ativo: false } })],
  ];
  it.each(casos)('%s: perfil e fotos aparecem, aviso e nenhum formulário', async (_n, preparar) => {
    const c = await criarCenarioReserva();
    await perfilCompleto(c);
    await preparar(c);
    const h = await html(c.s.slugAtual, { s: c.A, data: DIA_CHAVE });
    expect(h).toContain('Agendamento indisponível');
    expect(h).not.toContain('<form');
    expect(h).not.toContain('<button');
    expect(h).toContain('<h1>Studio Bela</h1>');
    expect(h).toContain('alt="Recepção do salão"');
  });
});

describe('CA-13: isolamento da página', () => {
  it('a página de um salão nunca mostra serviços, equipe, fotos ou horários do outro', async () => {
    const a = await criarCenarioReserva();
    const b = await criarCenarioReserva();
    await db().servico.update({ where: { id: b.A }, data: { nome: 'Serviço Exclusivo do B' } });
    await db().profissional.update({ where: { id: b.ana }, data: { nome: 'Profissional Exclusiva do B' } });
    await db().salaoFoto.create({
      data: { salaoId: b.s.salaoId, chave: `fotos/${randomUUID()}.webp`, alt: 'Foto exclusiva do B', posicao: 1, largura: 10, altura: 10, bytes: 1, envio: randomUUID() },
    });
    const h = await html(a.s.slugAtual);
    for (const proibido of ['Serviço Exclusivo do B', 'Profissional Exclusiva do B', 'Foto exclusiva do B', b.A, b.ana]) {
      expect(h).not.toContain(proibido);
    }
    // Com ids do outro salão na query, o passo volta aos serviços sem vazar nada.
    const h2 = await html(a.s.slugAtual, { s: b.A, data: DIA_CHAVE, h0: valorDoItem(b.ana, sp(DIA, '10:00')) });
    expect(h2).not.toContain('Serviço Exclusivo do B');
    expect(h2).not.toContain('Profissional Exclusiva do B');
    expect(h2).toContain('Algum dos serviços escolhidos não está mais disponível');
  });
});
