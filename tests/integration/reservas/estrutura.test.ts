import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReserva } from '@/server/reservas/criar-reserva';
import { obterPrisma } from '@/server/repos/db';

import { criarCenarioReserva, entradaReserva, instalarContadorDeComandos, sp, DIA } from '../../support/reservas';

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

describe('CA-25: número de comandos SQL independente da quantidade de serviços', () => {
  it('1 serviço e 3 serviços emitem o mesmo número de comandos', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const c = await criarCenarioReserva();
    const C = (
      await obterPrisma().servico.create({ data: { salaoId: c.s.salaoId, nome: 'C', precoCentavos: 3000, duracaoMin: 15 }, select: { id: true } })
    ).id;
    await obterPrisma().servicoProfissional.create({ data: { salaoId: c.s.salaoId, servicoId: C, profissionalId: c.ana } });

    const contador = instalarContadorDeComandos();
    try {
      // Aquece o cliente com log (conexão e metadados), sem contar.
      await criarReserva(c.ctxEquipe, entradaReserva(c, { inicio: sp(DIA, '08:00') }), { enfileirar });
      const medir = async (servicoIds: string[], hhmm: string) => {
        contador.reiniciar();
        const r = await criarReserva(c.ctxEquipe, entradaReserva(c, { servicoIds, inicio: sp(DIA, hhmm) }), { enfileirar });
        expect(r.resultado).toBe('criada');
        return contador.contar();
      };
      const um = await medir([c.A], '10:00');
      const tres = await medir([c.A, c.B, C], '12:00');
      expect(um).toBeGreaterThan(5);
      expect(tres).toBe(um);
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

  it('nada em src/app nem em src/worker importa o módulo, nem passa o gancho aposRevalidar', () => {
    for (const base of ['src/app', 'src/worker']) {
      for (const f of arquivos(join(RAIZ, base)).filter((x) => /\.tsx?$/.test(x) && !/\.test\.tsx?$/.test(x))) {
        const t = readFileSync(f, 'utf8');
        expect(t, f).not.toMatch(/@\/server\/reservas/);
        expect(t, f).not.toContain('aposRevalidar');
      }
    }
  });
});
