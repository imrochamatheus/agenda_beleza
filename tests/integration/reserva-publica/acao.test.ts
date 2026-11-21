import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reservarAcao } from '@/app/(publico)/[slug]/acoes';
import { estadoInicialReserva } from '@/app/(publico)/[slug]/estado';
import { obterPrisma } from '@/server/repos/db';

import { contarLinhas } from '../../support/reservas';
import { AGORA, DIA, criarCenarioReserva, sp } from '../../support/reserva-publica';
import type { CenarioReserva } from '../../support/reserva-publica';
import { telefoneNovo } from '../../support/sql';

// D-026 T-3: a casca 'use server' (FormData → serviço → estado ou redirecionamento 303) contra o PostgreSQL
// real. O relógio da casca (new Date()) é fixado em AGORA só no `Date`, sem tocar nos temporizadores do driver.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'], now: AGORA });
});
afterEach(() => {
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

  it('horário tomado: redirecionamento para o passo do horário com o aviso (código fechado), sem a chave nem o horário', async () => {
    const c = await criarCenarioReserva();
    await reservarAcao(estadoInicialReserva(CHAVE), formulario(c));
    const d = await digest(reservarAcao(estadoInicialReserva(randomUUID()), formulario(c, { chave: randomUUID() })));
    expect(d).toContain(`/${c.s.slugAtual}?s=${c.A}&p=qualquer&data=2026-12-01&aviso=horario_indisponivel`);
    expect(d.startsWith('NEXT_REDIRECT;')).toBe(true);
    expect(d).not.toContain('h=');
  });

  it('slug que mudou durante o fluxo: redireciona para o slug atual no mesmo passo, sem gravar', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    const d = await digest(reservarAcao(estadoInicialReserva(CHAVE), formulario(c, {}, c.s.slugHistorico)));
    expect(d).toContain(`/${c.s.slugAtual}?s=${c.A}&p=qualquer&data=2026-12-01&h=`);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });
});
