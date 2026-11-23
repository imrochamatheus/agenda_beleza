import { describe, expect, it } from 'vitest';

import { normalizarTelefoneBr } from '@/lib/telefone';
import { conferirItens, derivarReserva } from '@/server/reservas/itens';
import { partesLocais } from '@/server/tempo/fuso';

import { SALAO_A } from '../../../prisma/seed/salao-a';
import { SALAO_B } from '../../../prisma/seed/salao-b';
import { salaoE2eReservas, salaoE2eSuspenso } from '../../../prisma/seed/complemento-e2e';
import { planejar, sobreposicoes } from '../../../prisma/seed/plano';

// D-036 CA-7 (parte pura) e fuso: o plano não depende do fuso do processo (rodar com TZ=UTC e TZ=America/Sao_Paulo).

const AGORA = new Date('2026-11-21T15:30:00Z');
const TODOS = [SALAO_A, SALAO_B, salaoE2eReservas(1), salaoE2eSuspenso()];

describe('plano do seed', () => {
  it.each(TODOS.map((s) => [s.slug, s] as const))('%s: telefones já normalizados e sem sobreposição', (_n, spec) => {
    for (const c of spec.clientes) {
      if (c.telefone !== null) expect(normalizarTelefoneBr(c.telefone)).toBe(c.telefone);
    }
    expect(normalizarTelefoneBr(spec.perfil.telefone)).toBe(spec.perfil.telefone);
    const plano = planejar(spec, AGORA);
    expect(sobreposicoes(plano.reservas)).toEqual([]);
    // D-050: cada reserva passa na mesma checagem pura da criação (data única, RN-8, RN-9).
    for (const r of plano.reservas) expect([r.chave, conferirItens(r.itens, spec.fuso)]).toEqual([r.chave, { ok: true }]);
  });

  it('detecta sobreposição do mesmo profissional entre reservas (a verificação não é vazia)', () => {
    const [a] = planejar(SALAO_A, AGORA).reservas;
    expect(sobreposicoes([a!, { ...a!, chave: 'copia' }])).toEqual([
      ['r1:0', 'copia:0'],
      ['r1:1', 'copia:1'],
    ]);
    const cancelada = { ...a!, chave: 'cancelada', itens: a!.itens.map((i) => ({ ...i, status: 'cancelado' as const })) };
    expect(sobreposicoes([a!, cancelada])).toEqual([]);
  });

  it('reservas passadas terminam antes de agora; futuras começam a mais de 1 dia; avaliação depois do fim', () => {
    for (const spec of [SALAO_A, SALAO_B]) {
      const plano = planejar(spec, AGORA);
      const passadas = spec.reservas.filter((r) => r.dia < 0).map((r) => r.chave);
      for (const r of plano.reservas) {
        if (passadas.includes(r.chave)) expect(r.fim.getTime()).toBeLessThan(AGORA.getTime());
        else expect(r.inicio.getTime() - AGORA.getTime()).toBeGreaterThan(24 * 3600_000);
        for (const i of r.itens) {
          expect(i.ocupadoAte.getTime() - i.fim.getTime()).toBe(spec.intervaloMin * 60_000);
          expect(i.fim.getTime() - i.inicio.getTime()).toBe(i.duracaoMin * 60_000);
        }
      }
      for (const a of plano.avaliacoes) {
        const r = plano.reservas.find((x) => x.id === a.reservaId)!;
        expect(r.status).toBe('concluido');
        expect(a.criadoEm.getTime()).toBeGreaterThan(r.fim.getTime());
      }
    }
  });

  it('forma abreviada: itens do mesmo profissional em sequência, separados pelo intervalo do salão', () => {
    const a = planejar(SALAO_A, AGORA).reservas.find((x) => x.chave === 'r1')!;
    expect(a.itens.map((i) => [i.precoCentavos, i.duracaoMin])).toEqual([[9000, 60], [5500, 30]]);
    expect(a.itens[1]!.inicio).toEqual(a.itens[0]!.fim);
    expect(a.fim.getTime() - a.inicio.getTime()).toBe(90 * 60_000);
    // Salão B tem intervalo de 10 min: o 2º item começa no ocupado_ate do 1º (RN-9), não no fim.
    const b = planejar(SALAO_B, AGORA).reservas.find((x) => x.chave === 'r1')!;
    expect(b.itens[1]!.inicio).toEqual(b.itens[0]!.ocupadoAte);
    expect(b.fim.getTime() - b.inicio.getTime()).toBe((30 + 10 + 30) * 60_000);
  });

  it('CA-51: o exemplo tem 3 itens com 3 profissionais, manhã e tarde, no mesmo dia', () => {
    const r9 = planejar(SALAO_A, AGORA).reservas.find((x) => x.chave === 'r9')!;
    expect(r9.status).toBe('confirmado');
    expect(new Set(r9.itens.map((i) => i.profissionalId)).size).toBe(3);
    const horas = r9.itens.map((i) => partesLocais(i.inicio, SALAO_A.fuso).minutosDoDia);
    expect(horas).toEqual([10 * 60, 10 * 60 + 30, 14 * 60]);
    expect(new Set(r9.itens.map((i) => JSON.stringify(partesLocais(i.inicio, SALAO_A.fuso).data))).size).toBe(1);
    expect([r9.inicio, r9.fim]).toEqual([r9.itens[0]!.inicio, r9.itens[2]!.fim]);
  });

  it('derivados iguais aos de derivarReserva; item cancelado fica fora do envelope e do status', () => {
    for (const spec of TODOS) {
      for (const r of planejar(spec, AGORA).reservas) {
        const d = derivarReserva(r.itens, null, r.canceladaEm ?? AGORA);
        expect({ status: r.status, inicio: r.inicio, fim: r.fim }).toEqual({ status: d.status, inicio: d.inicio, fim: d.fim });
        expect(r.canceladaEm === null).toBe(r.status !== 'cancelado');
        if (r.canceladaEm) expect(r.canceladaEm.getTime()).toBeLessThan(r.inicio.getTime());
      }
    }
    const r10 = planejar(SALAO_A, AGORA).reservas.find((x) => x.chave === 'r10')!;
    expect(r10.itens.map((i) => i.status)).toEqual(['concluido', 'cancelado']);
    expect(r10.status).toBe('concluido');
    expect(r10.fim).toEqual(r10.itens[0]!.fim);
  });

  it('o primeiro item sem horário e o serviço desconhecido são recusados', () => {
    const base = { ...SALAO_A, avaliacoes: [] };
    expect(() =>
      planejar({ ...base, reservas: [{ chave: 'x', cliente: 'ana', dia: 1, status: 'confirmado', itens: [{ servico: 'corte', profissional: 'helena' }] }] }, AGORA),
    ).toThrow('primeiro item sem horário no seed: x');
    expect(() =>
      planejar({ ...base, reservas: [{ chave: 'x', cliente: 'ana', dia: 1, status: 'confirmado', profissional: 'helena', inicioMin: 600, servicos: ['nada'] }] }, AGORA),
    ).toThrow('serviço desconhecido no seed: nada');
  });

  it('o horário local do início é o pedido no fuso do salão (Manaus ≠ São Paulo)', () => {
    const r6 = planejar(SALAO_B, AGORA).reservas.find((x) => x.chave === 'r6')!;
    expect(partesLocais(r6.inicio, 'America/Manaus').minutosDoDia).toBe(9 * 60);
    expect(partesLocais(r6.inicio, 'America/Sao_Paulo').minutosDoDia).toBe(10 * 60);
  });
});
