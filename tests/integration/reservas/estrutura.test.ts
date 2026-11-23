import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReserva } from '@/server/reservas/criar-reserva';
import { obterPrisma } from '@/server/repos/db';

import { criarCenarioReserva, entradaReserva, instalarContadorDeComandos, sp, DIA } from '../../support/reservas';

import { item, jornadaDaBia, um } from './apoio-itens';

// D-025 T-6c: CA-25 (comandos constantes) e CA-26 (log sem dado pessoal; imports; sem env nova).
// O plano de consultaOcupacoes com o índice da exclusion segue no teste existente
// tests/integration/disponibilidade/plano.test.ts.

beforeEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => {
  vi.restoreAllMocks();
});

const enfileirar = async () => ({ criado: true as const, id: 'job' });
const RAIZ = process.cwd();

describe('CA-25 / D-050: número de comandos SQL', () => {
  it('constante na quantidade de itens; só o laço de travas dos profissionais distintos (A-10) soma 1 por profissional', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const c = await criarCenarioReserva({ jornada: [['00:00', '24:00']] });
    await jornadaDaBia(c, [['00:00', '24:00']]);
    const C = (
      await obterPrisma().servico.create({ data: { salaoId: c.s.salaoId, nome: 'C', precoCentavos: 3000, duracaoMin: 15 }, select: { id: true } })
    ).id;
    await obterPrisma().servicoProfissional.createMany({
      data: [
        { salaoId: c.s.salaoId, servicoId: C, profissionalId: c.ana },
        { salaoId: c.s.salaoId, servicoId: C, profissionalId: c.bia },
      ],
    });

    const contador = instalarContadorDeComandos();
    try {
      // Aquece o cliente com log (conexão e metadados), sem contar.
      await criarReserva(c.ctxEquipe, entradaReserva(c, um(c, sp(DIA, '08:00'))), { enfileirar });
      const medir = async (itens: ReturnType<typeof item>[]) => {
        contador.reiniciar();
        const r = await criarReserva(c.ctxEquipe, entradaReserva(c, { itens }), { enfileirar });
        expect(r.resultado).toBe('criada');
        return contador.contar();
      };
      const um1 = await medir([item(c, sp(DIA, '10:00'))]);
      const tresDaAna = await medir([item(c, sp(DIA, '12:00')), item(c, sp(DIA, '13:00'), { servicoId: c.B }), item(c, sp(DIA, '14:00'), { servicoId: C })]);
      const doisProfissionais = await medir([
        item(c, sp(DIA, '16:00'), { profissionalId: c.bia }),
        item(c, sp(DIA, '17:00'), { servicoId: c.B }),
        item(c, sp(DIA, '18:00'), { servicoId: C, profissionalId: c.bia }),
      ]);
      expect(um1).toBeGreaterThan(5);
      expect(tresDaAna).toBe(um1);
      expect(doisProfissionais).toBe(um1 + 1);
    } finally {
      await contador.encerrar();
    }
  });
});

describe('CA-26: log sem dado pessoal', () => {
  it('nenhuma linha de log traz nome, telefone, chave de requisição nem aceites', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = await criarCenarioReserva();
    const chaveRequisicao = '9a1c2a3e-8c1d-4b7a-9d11-0a1b2c3d4e5f';
    const nome = 'Fulana Exclusiva Silva';
    const telefone = '(11) 97777-6655';
    const entrada = entradaReserva(c, { chaveRequisicao, cliente: { nome, telefone }, aceites: { mensagensReserva: true, conviteAvaliacao: true } });
    await criarReserva(c.ctxSistema, entrada, { enfileirar });
    await criarReserva(c.ctxSistema, entrada, { enfileirar });
    await criarReserva(c.ctxSistema, { ...entrada, chaveRequisicao: undefined }, { enfileirar });
    const linhas = [...info.mock.calls, ...erro.mock.calls].map((x) => String(x[0]));
    expect(linhas.some((l) => l.includes('"evento":"reserva.criar"'))).toBe(true);
    const eventos = linhas.filter((l) => l.includes('"evento":"reserva.criar"')).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(eventos.map((e) => e.resultado)).toEqual(['criada', 'repetida', 'horario_indisponivel']);
    // D-050 §5: o evento leva a quantidade de itens, não o profissional.
    expect(eventos.map((e) => e.itens)).toEqual([1, 1, 1]);
    expect(eventos.every((e) => !('profissionalId' in e))).toBe(true);
    for (const l of linhas) {
      expect(l).not.toContain('Exclusiva');
      expect(l).not.toContain('97777');
      expect(l).not.toContain(chaveRequisicao);
      expect(l).not.toMatch(/conviteAvaliacao|mensagensReserva/);
    }
  });
});

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
}

describe('CA-26: estrutura', () => {
  const dir = join(RAIZ, 'src/server/reservas');
  const producao = arquivos(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  it('src/server/reservas não importa Prisma, pg-boss, adaptadores, next/* nem usa env ou use server', () => {
    expect(producao.length).toBeGreaterThanOrEqual(5);
    for (const f of producao) {
      const t = readFileSync(f, 'utf8');
      expect(t, f).not.toMatch(/from '(@\/generated|@prisma|pg-boss|next\b|@\/server\/integrations|@\/server\/queue)/);
      expect(t, f).not.toMatch(/process\.env|^'use server'/m);
    }
  });

  it('nada em src/app nem em src/worker importa criarReserva, nem passa o gancho aposRevalidar', () => {
    // D-029: a casca da reserva manual importa a ação, os contratos client-safe e as funções puras de
    // reserva-equipe; o ponto de entrada `criar-reserva` continua só do servidor (ações e serviços).
    for (const base of ['src/app', 'src/worker']) {
      for (const f of arquivos(join(RAIZ, base)).filter((x) => /\.tsx?$/.test(x) && !/\.test\.tsx?$/.test(x))) {
        const t = readFileSync(f, 'utf8');
        expect(t, f).not.toMatch(/@\/server\/reservas\/criar-reserva/);
        expect(t, f).not.toContain('aposRevalidar');
      }
    }
  });
});
