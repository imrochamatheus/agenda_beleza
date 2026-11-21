import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reservarAcao } from '@/app/(publico)/[slug]/acoes';
import { estadoInicialReserva } from '@/app/(publico)/[slug]/estado';
import { obterPrisma } from '@/server/repos/db';

import { contarLinhas } from '../../support/reservas';
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
// real. O relógio da casca (new Date()) é fixado em AGORA só no `Date`, sem tocar nos temporizadores do driver.

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
function formulario(c: CenarioReserva, sobre: Record<string, string> = {}, slug = c.s.slugAtual): FormData {
  const f = new FormData();
  const campos: Record<string, string> = {
    slug,
    p: 'qualquer',
    data: '2026-12-01',
    profissionalId: c.ana,
    inicio: sp(DIA, '10:00').toISOString(),
    chave: CHAVE,
    nome: 'Maria da Silva',
    telefone: telefoneNovo(),
    consentimento_mensagens: 'on',
    'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
    ...sobre,
  };
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  f.append('s', c.A);
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
    expect(a).toMatchObject({ status: 'confirmada', repetida: false, chave: CHAVE, resumo: { profissionalNome: 'Ana', totalCentavos: 5000 } });
    const b = await reservarAcao(estado, f);
    expect(b).toMatchObject({ status: 'confirmada', repetida: true, resumo: a.resumo });
    const depois = await contarLinhas(c.s.salaoId);
    expect(depois.reserva).toBe(1);
    expect(depois.cliente - antes.cliente).toBe(1);
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

  it('horário tomado (DEF-1): sem redirecionar, devolve na resposta os horários atualizados e os valores digitados', async () => {
    const c = await criarCenarioReserva();
    await reservarAcao(estadoInicialReserva(CHAVE), formulario(c));
    const antes = await contarLinhas(c.s.salaoId);
    const f = formulario(c, { chave: randomUUID(), nome: 'Maria Atrasada', telefone: '(11) 98765-4321', consentimento_convite: 'on' });
    const e = await reservarAcao(estadoInicialReserva(randomUUID()), f);
    expect(e.status).toBe('horario_indisponivel');
    expect(e.mensagem).toBe('Este horário não está mais disponível. Escolha outro horário.');
    expect(e.valores).toMatchObject({ nome: 'Maria Atrasada', telefone: '(11) 98765-4321', mensagensReserva: true, conviteAvaliacao: true });
    // Horários atualizados do dia: o tomado saiu da lista, e há outros.
    const tomado = sp(DIA, '10:00').toISOString();
    expect(e.reescolha?.fuso).toBe('America/Sao_Paulo');
    expect(e.reescolha?.horarios.length).toBeGreaterThan(0);
    expect(e.reescolha?.horarios).not.toContain(tomado);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('reescolha: reenviar com outro horário (Sem preferência) resolve o profissional e confirma', async () => {
    const c = await criarCenarioReserva();
    await reservarAcao(estadoInicialReserva(CHAVE), formulario(c));
    const conflito = await reservarAcao(estadoInicialReserva(randomUUID()), formulario(c, { chave: randomUUID() }));
    const novo = conflito.reescolha!.horarios[0]!;
    const f = formulario(c, { chave: randomUUID(), inicio: novo, profissionalId: '', reescolha: '1' });
    f.delete('profissionalId');
    const e = await reservarAcao(estadoInicialReserva(randomUUID()), f);
    expect(e.status).toBe('confirmada');
    expect(e.resumo?.inicioIso).toBe(novo);
  });

  it('reescolha com erro de validação continua mostrando os horários e preserva os valores', async () => {
    const c = await criarCenarioReserva();
    await reservarAcao(estadoInicialReserva(CHAVE), formulario(c));
    const conflito = await reservarAcao(estadoInicialReserva(randomUUID()), formulario(c, { chave: randomUUID() }));
    const f = formulario(c, { chave: randomUUID(), inicio: conflito.reescolha!.horarios[0]!, reescolha: '1', nome: 'A' });
    const e = await reservarAcao(estadoInicialReserva(randomUUID()), f);
    expect(e.status).toBe('editando');
    expect(e.erros.nome).toBeTruthy();
    expect(e.valores.nome).toBe('A');
    expect(e.reescolha?.horarios).toEqual(conflito.reescolha!.horarios);
  });

  it('slug que mudou durante o fluxo: redireciona para o slug atual no mesmo passo, sem gravar', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    const d = await digest(reservarAcao(estadoInicialReserva(CHAVE), formulario(c, {}, c.s.slugHistorico)));
    expect(d).toContain(`/${c.s.slugAtual}?s=${c.A}&p=qualquer&data=2026-12-01&h=`);
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
