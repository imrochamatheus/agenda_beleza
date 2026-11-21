import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarClienteFila } from '@/server/queue/client';
import { criarReserva } from '@/server/reservas/criar-reserva';
import { obterPrisma } from '@/server/repos/db';
import { criarReconciliarMensagens } from '@/worker/handlers/reconciliar-mensagens';
import type { ContextoJob } from '@/worker/handlers/tipos';

import { envDeTeste } from '../../support/fila';
import {
  DIA,
  contarLinhas,
  criarCenarioReserva,
  entradaReserva,
  inserirReservaDireta,
  instalarFalhaPorTrigger,
  sp,
} from '../../support/reservas';
import type { TabelaDeFalha } from '../../support/reservas';
import { conectar, telefoneNovo } from '../../support/sql';

// D-025 T-6c: CA-4, CA-6, CA-20, CA-23 (tudo ou nada, e a fila só depois do commit).

let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const db = () => obterPrisma();
const ctxJob = (): ContextoJob => ({
  id: 'j',
  fila: 'reconciliar-mensagens',
  tentativa: 1,
  tentativasMaximas: 5,
  agendadoPara: new Date(),
  sinal: new AbortController().signal,
  log: vi.fn(),
});

describe('CA-4: fila indisponível depois do commit', () => {
  it('enfileirar que falha: criada, mensagem pendente com a chave, e a reconciliação a envia depois', async () => {
    const cen = await criarCenarioReserva();
    const enfileirar = vi.fn(async () => {
      throw new Error('fila fora do ar');
    });
    const r = await criarReserva(cen.ctxSistema, entradaReserva(cen), { enfileirar });
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    expect(enfileirar).toHaveBeenCalledTimes(1);
    const m = await db().mensagem.findFirstOrThrow({ where: { reservaId: r.reserva.id } });
    expect(m).toMatchObject({ tipo: 'confirmacao', revisao: 0, estado: 'pendente' });
    expect(await db().reserva.count({ where: { salaoId: cen.s.salaoId } })).toBe(1);

    const reenfileirar = vi.fn(async () => ({ criado: true as const, id: 'job' }));
    await criarReconciliarMensagens({ enfileirar: reenfileirar, agora: () => new Date(Date.now() + 10 * 60_000) }).processar({}, ctxJob());
    expect(reenfileirar).toHaveBeenCalledWith('whatsapp-reserva', { mensagemId: m.id }, { chave: `${r.reserva.id}:confirmacao:0` });
  });

  it('pg-boss sem conexão (cliente real da fila apontando para uma porta fechada): criada', async () => {
    const cen = await criarCenarioReserva();
    const fila = criarClienteFila(envDeTeste({ DATABASE_URL: 'postgres://nada:nada@127.0.0.1:1/nada' }));
    try {
      const r = await criarReserva(cen.ctxSistema, entradaReserva(cen), { enfileirar: fila.enfileirar });
      expect(r.resultado).toBe('criada');
      expect(await db().mensagem.count({ where: { salaoId: cen.s.salaoId, estado: 'pendente' } })).toBe(1);
    } finally {
      await fila.encerrar();
    }
  }, 30_000);
});

describe('CA-6: o nome da cliente existente só muda se a transação for confirmada', () => {
  it('23P01 depois do upsert: o nome continua "Ana" e atualizado_em não muda; nada órfão', async () => {
    const cen = await criarCenarioReserva();
    const telefone = telefoneNovo();
    const ana = await db().cliente.create({ data: { salaoId: cen.s.salaoId, nome: 'Ana', telefoneE164: telefone }, select: { id: true, atualizadoEm: true } });
    const antes = await contarLinhas(cen.s.salaoId);
    // Depois da revalidação e antes do upsert, outra reserva ocupa o horário: o INSERT falha com 23P01.
    const aposRevalidar = async () => {
      await inserirReservaDireta(cen, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') });
    };
    const enfileirar = vi.fn();
    const r = await criarReserva(cen.ctxSistema, entradaReserva(cen, { cliente: { nome: 'Ana Souza', telefone } }), { aposRevalidar, enfileirar });
    expect(r).toEqual({ resultado: 'horario_indisponivel', causa: '23P01' });
    const depois = await db().cliente.findUniqueOrThrow({ where: { id: ana.id } });
    expect(depois.nome).toBe('Ana');
    expect(depois.atualizadoEm).toEqual(ana.atualizadoEm);
    // A reserva e a cliente injetadas pelo gancho são as únicas novas; nenhum item, consentimento nem mensagem.
    const contagem = await contarLinhas(cen.s.salaoId);
    expect(contagem).toEqual({ ...antes, reserva: antes.reserva + 1, cliente: antes.cliente + 1 });
    expect(enfileirar).not.toHaveBeenCalled();
  });
});

describe('CA-20: antesDaReserva (ponto de extensão da E4.2)', () => {
  it('recusa: recusado com o motivo; chamada depois do upsert e antes do INSERT; nada persiste', async () => {
    const cen = await criarCenarioReserva();
    const antes = await contarLinhas(cen.s.salaoId);
    const visto: { clienteExiste: boolean; reservas: number; inicio: Date; clienteId: string }[] = [];
    const antesDaReserva = vi.fn(async (ctx, r, d: { clienteId: string; inicio: Date }) => {
      const cliente = await r.clientes.buscarPorId(ctx, d.clienteId);
      visto.push({
        clienteExiste: cliente.id === d.clienteId,
        reservas: (await r.reservas.listarPorPeriodo(ctx, { de: sp(DIA, '00:00'), ate: sp(DIA, '23:59') })).length,
        ...d,
      });
      return { permitido: false as const, motivo: 'limite' };
    });
    const enfileirar = vi.fn();
    const r = await criarReserva(cen.ctxSistema, entradaReserva(cen), { antesDaReserva, enfileirar });
    expect(r).toEqual({ resultado: 'recusado', motivo: 'limite' });
    expect(visto).toHaveLength(1);
    expect(visto[0]).toMatchObject({ clienteExiste: true, reservas: 0, inicio: sp(DIA, '10:00') });
    expect(await contarLinhas(cen.s.salaoId)).toEqual(antes);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('permite: a reserva é criada normalmente', async () => {
    const cen = await criarCenarioReserva();
    const r = await criarReserva(cen.ctxSistema, entradaReserva(cen), {
      antesDaReserva: async () => ({ permitido: true }),
      enfileirar: async () => ({ criado: true, id: 'job' }),
    });
    expect(r.resultado).toBe('criada');
  });
});

describe('CA-23: falha forçada em cada etapa desfaz tudo', () => {
  const etapas: TabelaDeFalha[] = ['cliente', 'reserva', 'reserva_item', 'consentimento', 'mensagem'];
  it.each(etapas)('falha no INSERT de %s: nada persiste e a fila não é tocada', async (tabela) => {
    const cen = await criarCenarioReserva();
    const antes = await contarLinhas(cen.s.salaoId);
    const remover = await instalarFalhaPorTrigger(c, tabela);
    const enfileirar = vi.fn();
    try {
      await expect(criarReserva(cen.ctxSistema, entradaReserva(cen), { enfileirar })).rejects.toBeDefined();
    } finally {
      await remover();
    }
    expect(await contarLinhas(cen.s.salaoId)).toEqual(antes);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('falha lançada por antesDaReserva: nada persiste', async () => {
    const cen = await criarCenarioReserva();
    const antes = await contarLinhas(cen.s.salaoId);
    const enfileirar = vi.fn();
    await expect(
      criarReserva(cen.ctxSistema, entradaReserva(cen), {
        antesDaReserva: async () => {
          throw new Error('falha do gancho');
        },
        enfileirar,
      }),
    ).rejects.toThrow('falha do gancho');
    expect(await contarLinhas(cen.s.salaoId)).toEqual(antes);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('a falha DEPOIS do commit (enfileirar) não altera o resultado criada', async () => {
    const cen = await criarCenarioReserva();
    const r = await criarReserva(cen.ctxSistema, entradaReserva(cen), {
      enfileirar: async () => {
        throw new Error('fila');
      },
    });
    expect(r.resultado).toBe('criada');
    expect((await contarLinhas(cen.s.salaoId)).reserva).toBe(1);
  });
});
