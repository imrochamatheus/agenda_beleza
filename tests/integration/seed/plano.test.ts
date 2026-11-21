import { describe, expect, it } from 'vitest';

import { normalizarTelefoneBr } from '@/lib/telefone';
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
    expect(sobreposicoes(planejar(spec, AGORA).reservas)).toEqual([]);
  });

  it('detecta sobreposição do mesmo profissional (a verificação não é vazia)', () => {
    const [a] = planejar(SALAO_A, AGORA).reservas;
    expect(sobreposicoes([a!, { ...a!, chave: 'copia' }])).toEqual([[a!.chave, 'copia']]);
    expect(sobreposicoes([a!, { ...a!, chave: 'cancelada', status: 'cancelado' }])).toEqual([]);
  });

  it('reservas passadas terminam antes de agora; futuras começam a mais de 1 dia; avaliação depois do fim', () => {
    for (const spec of [SALAO_A, SALAO_B]) {
      const plano = planejar(spec, AGORA);
      const passadas = spec.reservas.filter((r) => r.dia < 0).map((r) => r.chave);
      for (const r of plano.reservas) {
        if (passadas.includes(r.chave)) expect(r.fim.getTime()).toBeLessThan(AGORA.getTime());
        else expect(r.inicio.getTime() - AGORA.getTime()).toBeGreaterThan(24 * 3600_000);
        expect(r.ocupadoAte.getTime() - r.fim.getTime()).toBe(spec.intervaloMin * 60_000);
      }
      for (const a of plano.avaliacoes) {
        const r = plano.reservas.find((x) => x.id === a.reservaId)!;
        expect(r.status).toBe('concluido');
        expect(a.criadoEm.getTime()).toBeGreaterThan(r.fim.getTime());
      }
    }
  });

  it('itens em sequência: a soma das durações é fim − início, com snapshot do serviço', () => {
    const r = planejar(SALAO_A, AGORA).reservas.find((x) => x.chave === 'r1')!;
    expect(r.itens.map((i) => [i.precoCentavos, i.duracaoMin])).toEqual([[9000, 60], [5500, 30]]);
    expect(r.fim.getTime() - r.inicio.getTime()).toBe(90 * 60_000);
  });

  it('o horário local do início é o pedido no fuso do salão (Manaus ≠ São Paulo)', () => {
    const r6 = planejar(SALAO_B, AGORA).reservas.find((x) => x.chave === 'r6')!;
    expect(partesLocais(r6.inicio, 'America/Manaus').minutosDoDia).toBe(9 * 60);
    expect(partesLocais(r6.inicio, 'America/Sao_Paulo').minutosDoDia).toBe(10 * 60);
  });
});
