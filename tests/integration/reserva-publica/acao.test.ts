import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reservarAcao } from '@/app/(publico)/[slug]/acoes';
import { estadoInicialReserva } from '@/app/(publico)/[slug]/estado';
import { obterPrisma } from '@/server/repos/db';
import { valorDoItem } from '@/server/reserva-publica/passos';

import { contarLinhas, definirJornada } from '../../support/reservas';
import { AGORA, DIA, criarCenarioReserva, sp } from '../../support/reserva-publica';
import type { CenarioReserva } from '../../support/reserva-publica';
import { telefoneNovo } from '../../support/sql';


// D-027: a ação e a página leem o IP em `headers()`; fora de uma requisição o Next lança. O IP vem de
// `x-forwarded-for` (TRUSTED_PROXY_HOPS=1) e muda a cada leitura, para os limites não vazarem entre casos.
const { proximoIp } = vi.hoisted(() => {
  let n = 0;
  return { proximoIp: () => `192.0.2.${(++n % 250) + 1}` };
});
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': proximoIp() }),
}));

// D-026 T-3: a casca 'use server' (FormData → serviço → estado ou redirecionamento 303) contra o PostgreSQL
// real. D-050: o POST traz `s`, `data` e `h<k>` (um item por serviço); depende da casca da T-11. O relógio da casca (new Date()) é fixado em AGORA só no `Date`, sem tocar nos temporizadores do driver.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'], now: AGORA });
  vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
afterAll(() => {
  vi.restoreAllMocks();
});

const CHAVE = randomUUID();
/**
 * Contrato do POST da casca (D-050 T-10 → T-11): `slug`, `s` (repetido, ordem de escolha), `data`, `h<k>`
 * (`<profissionalId>_<isoUTC>`), `chave`, `nome`, `telefone`, os aceites, `cf-turnstile-response` e, no
 * reenvio da reescolha, `reabrir` (repetido: índices dos itens que estavam abertos).
 */
function formulario(
  c: CenarioReserva,
  sobre: Record<string, string> = {},
  slug = c.s.slugAtual,
  itens: { servicoId: string; profissionalId: string; inicio: Date }[] = [{ servicoId: c.A, profissionalId: c.ana, inicio: sp(DIA, '10:00') }],
): FormData {
  const f = new FormData();
  f.append('slug', slug);
  for (const i of itens) f.append('s', i.servicoId);
  f.append('data', '2026-12-01');
  itens.forEach((i, k) => f.append(`h${k}`, valorDoItem(i.profissionalId, i.inicio)));
  const campos: Record<string, string> = {
    chave: CHAVE,
    nome: 'Maria da Silva',
    telefone: telefoneNovo(),
    consentimento_mensagens: 'on',
    'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
    ...sobre,
  };
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}
const digest = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return String((e as { digest?: unknown }).digest);
  }
  throw new Error('esperava um redirecionamento');
};

describe('reservarAcao', () => {
  it('sucesso: estado confirmada; reenvio da mesma chave devolve a mesma confirmação sem duplicar', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    const estado = estadoInicialReserva(CHAVE);
    const f = formulario(c);
    const a = await reservarAcao(estado, f);
    expect(a).toMatchObject({ status: 'confirmada', repetida: false, chave: CHAVE, resumo: { totalCentavos: 5000, itens: [{ profissionalNome: 'Ana' }] } });
    const b = await reservarAcao(estado, f);
    expect(b).toMatchObject({ status: 'confirmada', repetida: true, resumo: a.resumo });
    const depois = await contarLinhas(c.s.salaoId);
    expect(depois.reserva).toBe(1);
    expect(depois.cliente - antes.cliente).toBe(1);
  });

  it('dois itens com profissionais diferentes: uma reserva com os dois', async () => {
    const c = await criarCenarioReserva();
    await definirJornada(c.s.salaoId, c.bia, [['09:00', '19:00']]);
    const itens = [
      { servicoId: c.A, profissionalId: c.bia, inicio: sp(DIA, '10:00') },
      { servicoId: c.B, profissionalId: c.ana, inicio: sp(DIA, '10:30') },
    ];
    const e = await reservarAcao(estadoInicialReserva(CHAVE), formulario(c, {}, c.s.slugAtual, itens));
    expect(e.status).toBe('confirmada');
    expect(e.resumo?.itens.map((x) => x.profissionalNome)).toEqual(['Bia', 'Ana']);
  });

  it('campos inválidos: erros por campo e valores preservados, sem gravar', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    const e = await reservarAcao(estadoInicialReserva(CHAVE), formulario(c, { nome: 'A', telefone: '123', consentimento_mensagens: '' }));
    expect(e.status).toBe('editando');
    expect(Object.keys(e.erros).sort()).toEqual(['mensagensReserva', 'nome', 'telefone']);
    expect(e.valores).toMatchObject({ nome: 'A', telefone: '123', mensagensReserva: false });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('salão suspenso: estado indisponível e nada gravado', async () => {
    const c = await criarCenarioReserva();
    await obterPrisma().salao.update({ where: { id: c.s.salaoId }, data: { suspensoManualEm: AGORA } });
    const antes = await contarLinhas(c.s.salaoId);
    expect((await reservarAcao(estadoInicialReserva(CHAVE), formulario(c))).status).toBe('indisponivel');
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('CA-10: horário tomado: sem redirecionar, a resposta aponta o item, traz horários atualizados e os valores digitados', async () => {
    const c = await criarCenarioReserva();
    await reservarAcao(estadoInicialReserva(CHAVE), formulario(c));
    const antes = await contarLinhas(c.s.salaoId);
    const f = formulario(c, { chave: randomUUID(), nome: 'Maria Atrasada', telefone: '(11) 98765-4321', consentimento_convite: 'on' });
    const e = await reservarAcao(estadoInicialReserva(randomUUID()), f);
    expect(e.status).toBe('horario_indisponivel');
    expect(e.valores).toMatchObject({ nome: 'Maria Atrasada', telefone: '(11) 98765-4321', mensagensReserva: true, conviteAvaliacao: true });
    const tomado = sp(DIA, '10:00').toISOString();
    expect(e.reescolha).toMatchObject({ resultado: 'reescolher', fuso: 'America/Sao_Paulo', itens: [{ indice: 0, caiu: true, horarioAnteriorIso: tomado }] });
    const ana = e.reescolha?.resultado === 'reescolher' ? e.reescolha.itens[0].profissionais.find((p) => p.id === c.ana)! : null;
    expect(ana?.horarios.length).toBeGreaterThan(0);
    expect(ana?.horarios).not.toContain(tomado);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('reescolha: reenviar com o novo horário (o rádio traz o profissional) confirma', async () => {
    const c = await criarCenarioReserva();
    await reservarAcao(estadoInicialReserva(CHAVE), formulario(c));
    const conflito = await reservarAcao(estadoInicialReserva(randomUUID()), formulario(c, { chave: randomUUID() }));
    if (conflito.reescolha?.resultado !== 'reescolher') throw new Error('sem reescolha');
    const novo = conflito.reescolha.itens[0].profissionais.find((p) => p.horarios.length > 0)!;
    const f = formulario(c, { chave: randomUUID(), h0: valorDoItem(novo.id, novo.horarios[0]) });
    f.append('reabrir', '0');
    const e = await reservarAcao(estadoInicialReserva(randomUUID()), f);
    expect(e.status).toBe('confirmada');
    expect(e.resumo?.itens[0].inicioIso).toBe(novo.horarios[0]);
  });

  it('reescolha com erro de validação continua mostrando a grade do item e preserva os valores', async () => {
    const c = await criarCenarioReserva();
    await reservarAcao(estadoInicialReserva(CHAVE), formulario(c));
    const conflito = await reservarAcao(estadoInicialReserva(randomUUID()), formulario(c, { chave: randomUUID() }));
    if (conflito.reescolha?.resultado !== 'reescolher') throw new Error('sem reescolha');
    const novo = conflito.reescolha.itens[0].profissionais.find((p) => p.horarios.length > 0)!;
    const f = formulario(c, { chave: randomUUID(), h0: valorDoItem(novo.id, novo.horarios[0]), nome: 'A' });
    f.append('reabrir', '0');
    const e = await reservarAcao(estadoInicialReserva(randomUUID()), f);
    expect(e.status).toBe('editando');
    expect(e.erros.nome).toBeTruthy();
    expect(e.valores.nome).toBe('A');
    expect(e.reescolha).toMatchObject({ resultado: 'reescolher', itens: [{ indice: 0, caiu: false, preSelecionado: valorDoItem(novo.id, novo.horarios[0]) }] });
  });

  it('slug que mudou durante o fluxo: redireciona para o slug atual no passo de dados, sem gravar', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    const d = await digest(reservarAcao(estadoInicialReserva(CHAVE), formulario(c, {}, c.s.slugHistorico)));
    expect(d).toContain(`/${c.s.slugAtual}?s=${c.A}&data=2026-12-01&h0=${encodeURIComponent(valorDoItem(c.ana, sp(DIA, '10:00')))}`);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });
});

describe('reservarAcao: proteção (D-027 CA-5, CA-13)', () => {
  it('sem token humano: estado editando com a mensagem, nada gravado', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    const f = formulario(c, { 'cf-turnstile-response': '' });
    const e = await reservarAcao(estadoInicialReserva(CHAVE), f);
    expect(e).toMatchObject({
      status: 'editando',
      mensagem: 'Não foi possível confirmar que você é uma pessoa. Tente novamente.',
      valores: { nome: 'Maria da Silva' },
    });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('com TRUSTED_PROXY_HOPS=0 o IP é "desconhecido" e o balde é único; excedido, mensagem de limite', async () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '0');
    vi.stubEnv('PROTECAO_LIMITE_IP_RESERVA', '2');
    const c = await criarCenarioReserva();
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await reservarAcao(estadoInicialReserva(CHAVE), formulario(c, { 'cf-turnstile-response': '' })));
    expect(r.map((x) => x.mensagem)).toEqual([
      'Não foi possível confirmar que você é uma pessoa. Tente novamente.',
      'Não foi possível confirmar que você é uma pessoa. Tente novamente.',
      'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
      'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    ]);
  });
});
