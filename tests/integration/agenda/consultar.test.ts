import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultarAgenda, lerReservaDaAgenda } from '@/server/agenda/consultar';
import { LIMITES_AGENDA, MENSAGENS_AGENDA } from '@/server/agenda/tipos';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';
import { criarTenantContext } from '@/server/tenant/context';

import { definirAssinatura } from '../../support/reserva-publica';
import { definirFuncionamento, definirJornada, instalarContadorDeComandos } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { conectar } from '../../support/sql';

import {
  AGORA,
  UUID_INEXISTENTE,
  anonimizarPorSql,
  bloquear,
  criarCenario,
  ctxDaAna,
  hora,
  inserirCliente,
  reservar,
  reservarComItens,
} from './apoio';

// D-028 T-3: serviço de leitura (CA-1, 2, 5, 6, 9, 10, 12, 13, 15, 16, 17). Relógio injetado: terça 01/12/2026.

let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

const DIA = '2026-12-01';
const ids = (v: { colunas: { id: string }[] }) => v.colunas.map((x) => x.id);

describe('CA-2: gestor e filtro', () => {
  it('sem filtro vê Ana e Bia; com filtro só a escolhida e os bloqueios dela e do salão', async () => {
    const ce = await criarCenario();
    const ra = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00') });
    const rb = await reservar(c, ce, { profissionalId: ce.bia, inicio: hora('11:00') });
    const bAna = await bloquear(c, ce.s.salaoId, { profissionalId: ce.ana, inicio: hora('13:00'), fim: hora('14:00'), motivo: 'Dentista' });
    const bBia = await bloquear(c, ce.s.salaoId, { profissionalId: ce.bia, inicio: hora('13:00'), fim: hora('14:00'), motivo: 'Médico' });
    const bSalao = await bloquear(c, ce.s.salaoId, { profissionalId: null, inicio: hora('16:00'), fim: hora('17:00'), motivo: 'Reunião' });

    const todos = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    expect(new Set(ids(todos))).toEqual(new Set([ce.ana, ce.bia]));
    const ana = todos.colunas.find((x) => x.id === ce.ana)!;
    const bia = todos.colunas.find((x) => x.id === ce.bia)!;
    expect(ana.blocos.map((r) => r.reservaId)).toEqual([ra]);
    expect(bia.blocos.map((r) => r.reservaId)).toEqual([rb]);
    expect(ana.bloqueios.map((b) => b.id).sort()).toEqual([bAna, bSalao].sort());
    expect(bia.bloqueios.map((b) => b.id).sort()).toEqual([bBia, bSalao].sort());
    expect(ana.bloqueios.find((b) => b.id === bAna)!.motivo).toBe('Dentista');
    // Opções do filtro: todos os profissionais do salão, inclusive o inativo da fábrica.
    expect(todos.profissionais.map((p) => p.id)).toEqual(expect.arrayContaining([ce.ana, ce.bia, ce.s.profissionalInativoId]));

    const so = await consultarAgenda(ce.ctxEquipe, { data: DIA, profissional: ce.ana }, AGORA);
    expect(ids(so)).toEqual([ce.ana]);
    expect(so.colunas[0].blocos.map((r) => r.reservaId)).toEqual([ra]);
    expect(so.colunas[0].bloqueios.map((b) => b.id).sort()).toEqual([bAna, bSalao].sort());
    expect(so.profissionalFiltro).toBe(ce.ana);
  });

  it('filtro inválido, malformado ou de outro salão → NaoEncontrado (RN-12)', async () => {
    const ce = await criarCenario();
    const outro = await criarCenario();
    for (const p of ['lixo', UUID_INEXISTENTE, outro.ana, '  ']) {
      if (p.trim() === '') {
        // Só espaços vale como ausente.
        expect(ids(await consultarAgenda(ce.ctxEquipe, { profissional: p }, AGORA))).toEqual([ce.ana]);
      } else {
        await expect(consultarAgenda(ce.ctxEquipe, { data: DIA, profissional: p }, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
      }
    }
  });
});

describe('CA-1: profissional só vê a própria agenda', () => {
  it('a agenda traz só a Ana, mesmo com `profissional` de outra; o detalhe de outra profissional é 404', async () => {
    const ce = await criarCenario();
    const ra = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00') });
    const rb = await reservar(c, ce, { profissionalId: ce.bia, inicio: hora('11:00') });
    await bloquear(c, ce.s.salaoId, { profissionalId: ce.bia, inicio: hora('13:00'), fim: hora('14:00'), motivo: 'Segredo da Bia' });
    const bSalao = await bloquear(c, ce.s.salaoId, { profissionalId: null, inicio: hora('16:00'), fim: hora('17:00'), motivo: 'Reunião' });
    const ctx = ctxDaAna(ce);
    for (const profissional of [undefined, ce.bia, 'lixo', UUID_INEXISTENTE]) {
      const v = await consultarAgenda(ctx, { data: DIA, profissional }, AGORA);
      expect(ids(v)).toEqual([ce.ana]);
      expect(v.colunas[0].blocos.map((r) => r.reservaId)).toEqual([ra]);
      expect(v.colunas[0].bloqueios.map((b) => b.id)).toEqual([bSalao]);
      expect(v.profissionais).toEqual([]);
      expect(v.profissionalFiltro).toBe(ce.ana);
      expect(JSON.stringify(v)).not.toContain('Segredo da Bia');
    }
    expect((await lerReservaDaAgenda(ctx, ra, AGORA)).id).toBe(ra);
    await expect(lerReservaDaAgenda(ctx, rb, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerReservaDaAgenda(ctx, UUID_INEXISTENTE, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerReservaDaAgenda(ctx, 'lixo', AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('operação negada e perfil ausente → AcessoNegado', async () => {
    const ce = await criarCenario();
    const semPerfil = criarTenantContext({ usuarioId: ce.s.profissional.usuarioId, papel: 'profissional', salaoId: ce.s.salaoId, profissionalId: null });
    await expect(consultarAgenda(semPerfil, {}, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(lerReservaDaAgenda(semPerfil, UUID_INEXISTENTE, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
  });
});

describe('CA-5, CA-6, CA-12: reservas', () => {
  it('anonimizada: sem nome, com itens e preços do snapshot; detalhe sem contato', async () => {
    const ce = await criarCenario();
    const cli = await inserirCliente(c, ce.s.salaoId, 'Fulana de Tal', '+5511955550001');
    const id = await reservar(c, ce, {
      profissionalId: ce.ana,
      inicio: hora('10:00'),
      clienteId: cli,
      itens: [
        { servicoId: ce.A, precoCentavos: 5000, duracaoMin: 30 },
        { servicoId: ce.B, precoCentavos: 7000, duracaoMin: 45 },
      ],
    });
    await anonimizarPorSql(c, cli);
    const v = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    const blocos = v.colunas[0].blocos;
    expect(blocos.every((b) => b.clienteNome === null)).toBe(true);
    expect(blocos.map((b) => [b.servicoNome, b.precoCentavos, b.duracaoMin])).toEqual([
      ['A', 5000, 30],
      ['B', 7000, 45],
    ]);
    const d = await lerReservaDaAgenda(ce.ctxEquipe, id, AGORA);
    expect(d).toMatchObject({ clienteNome: null, anonimizada: true, contato: null, total: { centavos: 12000, servicos: 2, rotulo: 'reserva' } });
    expect(JSON.stringify([v, d])).not.toMatch(/Fulana|5511955550001/);
  });

  it('profissional inativo: o gestor vê a reserva passada com o nome e a marca de inativo (CA-6)', async () => {
    const ce = await criarCenario();
    const id = await reservar(c, ce, { profissionalId: ce.bia, inicio: hora('09:00', -3), status: 'concluido' });
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [ce.bia]);
    const v = await consultarAgenda(ce.ctxEquipe, { data: '2026-11-28' }, AGORA);
    const col = v.colunas.find((x) => x.id === ce.bia)!;
    expect(col).toMatchObject({ nome: 'Bia', ativo: false });
    expect(col.blocos.map((r) => r.reservaId)).toEqual([id]);
    // Sem nada no período, a inativa some; ativa com jornada continua.
    const outro = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    expect(ids(outro)).toEqual([ce.ana]);
    expect(outro.profissionais.find((p) => p.id === ce.bia)).toMatchObject({ ativo: false });
  });

  it('todos os status aparecem com o status certo (CA-12)', async () => {
    const ce = await criarCenario();
    const porStatus: Record<string, string> = {};
    for (const [i, status] of (['confirmado', 'cancelado', 'concluido', 'nao_compareceu'] as const).entries()) {
      porStatus[await reservar(c, ce, { profissionalId: ce.ana, inicio: hora(`${9 + i}:00`), status })] = status;
    }
    const v = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    expect(Object.fromEntries(v.colunas[0].blocos.map((r) => [r.reservaId, r.status]))).toEqual(porStatus);
  });

  it('encaixe sobreposto no mesmo profissional aparece junto (sem esconder)', async () => {
    const ce = await criarCenario();
    await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00') });
    await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:30'), status: 'cancelado', encaixe: true });
    const v = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    expect(v.colunas[0].blocos).toHaveLength(2);
    expect(v.colunas[0].blocos.some((r) => r.encaixe)).toBe(true);
  });
});

describe('detalhe: contato (CA-17) e campos', () => {
  it('gestor e a profissional da reserva recebem o telefone; sem lista de mensagens no DTO', async () => {
    const ce = await criarCenario();
    const cli = await inserirCliente(c, ce.s.salaoId, 'Maria', '+5511955550002');
    const id = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00'), clienteId: cli });
    for (const ctx of [ce.ctxEquipe, ctxDaAna(ce)]) {
      const d = await lerReservaDaAgenda(ctx, id, AGORA);
      expect(d).toMatchObject({
        id,
        clienteId: cli,
        fuso: 'America/Sao_Paulo',
        clienteNome: 'Maria',
        anonimizada: false,
        contato: { telefoneE164: '+5511955550002' },
        data: { ano: 2026, mes: 12, dia: 1 },
        status: 'confirmado',
        origem: 'equipe',
        temItemCancelado: false,
        podeCancelarTodos: false,
      });
      expect(d.itens).toMatchObject([
        { profissionalId: ce.ana, profissionalNome: 'Ana', profissionalAtivo: true, inicio: hora('10:00'), fim: hora('11:00'), encaixe: false, status: 'confirmado' },
      ]);
      // D-043: o DTO só ganha o indicador de falha vigente; nenhuma lista de mensagens, parâmetro nem WhatsApp.
      expect(Object.keys(d).filter((k) => k !== 'temFalhaDeMensagem').join()).not.toMatch(/mensag|whatsapp|parametros/i);
    }
  });

  it('a grade nunca leva o telefone (CA-17)', async () => {
    const ce = await criarCenario();
    const cli = await inserirCliente(c, ce.s.salaoId, 'Maria', '+5511955550003');
    await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00'), clienteId: cli });
    const v = await consultarAgenda(ce.ctxEquipe, { data: DIA, visao: 'semana' }, AGORA);
    expect(JSON.stringify(v)).not.toContain('5511955550003');
    expect(JSON.stringify(v)).toContain('Maria');
  });
});

describe('CA-9: bloqueios', () => {
  it('próprio e do salão com motivo; fora do período e encostando na fronteira não aparecem', async () => {
    const ce = await criarCenario();
    const proprio = await bloquear(c, ce.s.salaoId, { profissionalId: ce.ana, inicio: hora('13:00'), fim: hora('14:00'), motivo: 'Dentista' });
    const salao = await bloquear(c, ce.s.salaoId, { profissionalId: null, inicio: hora('00:00'), fim: hora('00:00', 1), motivo: 'Feriado' });
    await bloquear(c, ce.s.salaoId, { profissionalId: ce.ana, inicio: hora('22:00', -1), fim: hora('00:00'), motivo: 'Encosta antes' });
    await bloquear(c, ce.s.salaoId, { profissionalId: ce.ana, inicio: hora('00:00', 1), fim: hora('02:00', 1), motivo: 'Encosta depois' });
    await bloquear(c, ce.s.salaoId, { profissionalId: ce.ana, inicio: hora('10:00', 5), fim: hora('11:00', 5), motivo: 'Outro dia' });
    const v = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    const b = v.colunas.find((x) => x.id === ce.ana)!.bloqueios;
    expect(b.map((x) => [x.id, x.motivo]).sort()).toEqual([[proprio, 'Dentista'], [salao, 'Feriado']].sort());
    expect(JSON.stringify(v)).not.toMatch(/Encosta|Outro dia/);
  });
});

describe('CA-10: salão suspenso', () => {
  it('a agenda e o detalhe abrem normalmente (sem checagem de suspensão)', async () => {
    const ce = await criarCenario();
    const id = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00') });
    await c.query('UPDATE salao SET suspenso_manual_em = now() WHERE id = $1', [ce.s.salaoId]);
    await definirAssinatura(ce.s.salaoId, 'suspensa');
    for (const ctx of [ce.ctxEquipe, ctxDaAna(ce)]) {
      const v = await consultarAgenda(ctx, { data: DIA }, AGORA);
      expect(v.colunas.find((x) => x.id === ce.ana)!.blocos.map((r) => r.reservaId)).toEqual([id]);
      expect((await lerReservaDaAgenda(ctx, id, AGORA)).id).toBe(id);
    }
  });
});

describe('CA-13 e RN-2: período no fuso do salão', () => {
  it('reserva 23:00–01:00 aparece nos dois dias; a semana começa no domingo', async () => {
    const ce = await criarCenario();
    const id = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('23:00'), fim: hora('01:00', 1) });
    for (const data of [DIA, '2026-12-02']) {
      const v = await consultarAgenda(ce.ctxEquipe, { data }, AGORA);
      expect(v.colunas.find((x) => x.id === ce.ana)!.blocos.map((r) => r.reservaId)).toEqual([id]);
    }
    const dia3 = await consultarAgenda(ce.ctxEquipe, { data: '2026-12-03' }, AGORA);
    expect(dia3.colunas.find((x) => x.id === ce.ana)!.blocos).toEqual([]);
    const sem = await consultarAgenda(ce.ctxEquipe, { data: '2026-12-02', visao: 'semana' }, AGORA);
    expect(sem.dias.map((d) => d.iso)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
    expect(sem.colunas.find((x) => x.id === ce.ana)!.blocos.map((r) => r.reservaId)).toEqual([id]);
  });

  it('"hoje" é a data do salão, não do processo: 02:00Z ainda é o dia anterior em São Paulo', async () => {
    const ce = await criarCenario();
    const v = await consultarAgenda(ce.ctxEquipe, {}, new Date('2026-12-02T02:00:00Z'));
    expect(v.data).toBe('2026-12-01');
    expect(v.hoje).toBe('2026-12-01');
  });
});

describe('CA-7, CA-8: faixas de fundo a partir do banco', () => {
  it('funcionamento 09–18 e jornada 09–12/14–18', async () => {
    const ce = await criarCenario({ jornada: [['09:00', '12:00'], ['14:00', '18:00']], funcionamento: { 2: [['09:00', '18:00']] } });
    const v = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    expect(v.dias[0].foraDoFuncionamento).toEqual([{ inicioMin: 0, fimMin: 540 }, { inicioMin: 1080, fimMin: 1440 }]);
    expect(v.dias[0].salaoFechado).toBe(false);
    expect(v.colunas[0].foraDaJornada[DIA]).toEqual([{ inicioMin: 720, fimMin: 840 }]);
    // Quarta fechada (funcionamento definido sem o dia 3).
    const quarta = await consultarAgenda(ce.ctxEquipe, { data: '2026-12-02' }, AGORA);
    expect(quarta.dias[0].salaoFechado).toBe(true);
  });

  it('funcionamento não definido não pinta nada; profissional sem jornada: tudo fora da jornada', async () => {
    const ce = await criarCenario();
    await definirJornada(ce.s.salaoId, ce.ana, []);
    await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00') });
    const v = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    expect(v.dias[0].foraDoFuncionamento).toEqual([]);
    expect(v.colunas[0].foraDaJornada[DIA]).toEqual([{ inicioMin: 0, fimMin: 1440 }]);
    await definirFuncionamento(ce.s.salaoId, {});
    const fechado = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    expect(fechado.dias[0].salaoFechado).toBe(true);
    expect(fechado.colunas[0].blocos).toHaveLength(1); // reserva fora do funcionamento continua visível
  });
});

describe('CA-15: parâmetros malformados', () => {
  it('data e visão inválidas caem no padrão (hoje, dia), sem erro', async () => {
    const ce = await criarCenario();
    for (const entrada of [
      { data: 'x', visao: 'y' },
      { data: '2026-02-30' },
      { data: '9999-01-01' },
      { data: '1900-01-01' },
      { data: ['2026-12-05'], visao: ['semana'] },
      { data: 5, visao: null, profissional: undefined },
      { data: '2026-12-01\u0000' },
    ]) {
      const v = await consultarAgenda(ce.ctxEquipe, entrada, AGORA);
      expect(v.data).toBe(DIA);
      expect(v.visao).toBe('dia');
    }
  });
});

describe('truncamento (R-1; D-050 CA-35: o limite conta itens)', () => {
  it('201 itens no período (em 67 reservas de 3 itens): 200 blocos, truncada e o aviso de serviços', async () => {
    const ce = await criarCenario();
    const cli = await inserirCliente(c, ce.s.salaoId, 'Muitas');
    const { rows } = await c.query<{ id: string }>(
      "INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min) VALUES ($1, 'C', 100, 1) RETURNING id::text AS id",
      [ce.s.salaoId],
    );
    const servicos = [ce.A, ce.B, rows[0].id];
    await c.query(
      `WITH d AS (
         SELECT gen_random_uuid() AS id, g, $4::timestamptz + g * interval '3 minutes' AS t FROM generate_series(0, 66) g
       ), r AS (
         INSERT INTO reserva (id, salao_id, cliente_id, inicio, fim, status, origem, cancelada_em)
         SELECT id, $1::uuid, $3::uuid, t, t + interval '3 minutes', 'cancelado', 'equipe', t FROM d
       )
       INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                 inicio, fim, ocupado_ate, status)
       SELECT $1::uuid, d.id, ($5::uuid[])[k + 1], $2::uuid, k, 100, 1, d.t + k * interval '1 minute',
              d.t + (k + 1) * interval '1 minute', d.t + (k + 1) * interval '1 minute', 'cancelado'
         FROM d CROSS JOIN generate_series(0, 2) k`,
      [ce.s.salaoId, ce.ana, cli, hora('08:00'), servicos],
    );
    const v = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    expect(LIMITES_AGENDA.itens).toBe(200);
    expect(v.colunas[0].blocos).toHaveLength(200);
    expect(v.truncada).toBe(true);
    expect(MENSAGENS_AGENDA.truncada).toBe(
      'Mostrando os primeiros 200 serviços deste período. Use o filtro de profissional ou a visão por dia para ver o restante.',
    );
    // 200 exatos não truncam.
    await c.query(
      `DELETE FROM reserva_item WHERE id = (SELECT id FROM reserva_item WHERE salao_id = $1 ORDER BY inicio DESC, id DESC LIMIT 1)`,
      [ce.s.salaoId],
    );
    const exatos = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    expect(exatos.colunas[0].blocos).toHaveLength(200);
    expect(exatos.truncada).toBe(false);
  });
});

describe('CA-16: instruções SQL constantes', () => {
  async function medir(ce: CenarioReserva, entrada: { data: string; visao?: string; profissional?: string }) {
    const contador = instalarContadorDeComandos();
    try {
      await consultarAgenda(ce.ctxEquipe, entrada, AGORA);
      return contador.contar();
    } finally {
      await contador.encerrar();
    }
  }

  it('1 reserva e 1 profissional × 50 reservas de 2 itens e 5 profissionais, dia e semana, gestor e profissional: 6', async () => {
    const pouco = await criarCenario();
    await reservar(c, pouco, { profissionalId: pouco.ana, inicio: hora('10:00') });
    const muito = await criarCenario();
    const profs = [muito.ana, muito.bia];
    for (let k = 3; k <= 5; k++) {
      const { rows } = await c.query<{ id: string }>('INSERT INTO profissional (salao_id, nome) VALUES ($1, $2) RETURNING id::text AS id', [muito.s.salaoId, `P${k}`]);
      profs.push(rows[0].id);
    }
    for (let i = 0; i < 50; i++) {
      await reservar(c, muito, {
        profissionalId: profs[i % 5],
        inicio: new Date(hora('08:00').getTime() + Math.floor(i / 5) * 60 * 60_000),
        itens: [
          { servicoId: muito.A, precoCentavos: 5000, duracaoMin: 30 },
          { servicoId: muito.B, precoCentavos: 7000, duracaoMin: 30, profissionalId: profs[(i + 1) % 5] },
        ],
      });
    }
    const resultados = [];
    for (const entrada of [{ data: DIA }, { data: DIA, visao: 'semana' }, { data: DIA, profissional: pouco.ana }]) {
      resultados.push(await medir(pouco, entrada));
    }
    const grandes = [];
    for (const entrada of [{ data: DIA }, { data: DIA, visao: 'semana' }, { data: DIA, profissional: muito.ana }]) {
      grandes.push(await medir(muito, entrada));
    }
    console.info(`[D-028 CA-16] pequeno=${resultados.join(',')} grande=${grandes.join(',')}`);
    expect(new Set([...resultados, ...grandes])).toEqual(new Set([6]));
    const v = await consultarAgenda(muito.ctxEquipe, { data: DIA }, AGORA);
    expect(v.colunas).toHaveLength(5);
    expect(v.colunas.reduce((t, x) => t + x.blocos.length, 0)).toBe(100);
    // O profissional (só a própria coluna, sem posição) também faz 6.
    const contador = instalarContadorDeComandos();
    try {
      await consultarAgenda(ctxDaAna(muito), { data: DIA }, AGORA);
      expect(contador.contar()).toBe(6);
    } finally {
      await contador.encerrar();
    }
  });
});

describe('D-050: agenda e detalhe por item (CA-32, CA-33, RN-35, RN-36)', () => {
  /** Reserva do CA-6: Escova (A) com Bia 09:00, Hidratação (B) com Ana 10:00, Manicure (C) com Carla 15:00. */
  async function cenarioCa6(o: { status?: ('confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu')[] } = {}) {
    const ce = await criarCenario();
    const { rows: carla } = await c.query<{ id: string }>("INSERT INTO profissional (salao_id, nome) VALUES ($1, 'Carla') RETURNING id::text AS id", [ce.s.salaoId]);
    const { rows: manicure } = await c.query<{ id: string }>(
      "INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min) VALUES ($1, 'Manicure', 4000, 45) RETURNING id::text AS id",
      [ce.s.salaoId],
    );
    const cli = await inserirCliente(c, ce.s.salaoId, 'Maria Souza', '+5511955550009');
    const st = o.status ?? ['confirmado', 'confirmado', 'confirmado'];
    const r = await reservarComItens(c, ce, {
      profissionalId: ce.ana,
      inicio: hora('09:00'),
      clienteId: cli,
      itens: [
        { servicoId: ce.A, precoCentavos: 9000, duracaoMin: 60, profissionalId: ce.bia, inicio: hora('09:00'), status: st[0] },
        { servicoId: ce.B, precoCentavos: 7500, duracaoMin: 40, profissionalId: ce.ana, inicio: hora('10:00'), status: st[1] },
        { servicoId: manicure[0].id, precoCentavos: 4000, duracaoMin: 45, profissionalId: carla[0].id, inicio: hora('15:00'), status: st[2], encaixe: true },
      ],
    });
    return { ce, carla: carla[0].id, cli, ...r };
  }

  it('CA-32: gestor vê um bloco por item na coluna de cada profissional, todos da mesma reserva, com "n de 3"', async () => {
    const { ce, carla, reservaId, itemIds } = await cenarioCa6();
    const v = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    const porColuna = Object.fromEntries(v.colunas.map((col) => [col.id, col.blocos]));
    expect(porColuna[ce.bia].map((b) => [b.itemId, b.servicoNome, b.inicio, b.fim, b.posicao])).toEqual([
      [itemIds[0], 'A', hora('09:00'), hora('10:00'), { n: 1, de: 3 }],
    ]);
    expect(porColuna[ce.ana].map((b) => [b.itemId, b.servicoNome, b.inicio, b.fim, b.posicao])).toEqual([
      [itemIds[1], 'B', hora('10:00'), hora('10:40'), { n: 2, de: 3 }],
    ]);
    expect(porColuna[carla].map((b) => [b.itemId, b.servicoNome, b.encaixe, b.posicao])).toEqual([[itemIds[2], 'Manicure', true, { n: 3, de: 3 }]]);
    const todos = v.colunas.flatMap((col) => col.blocos);
    expect(new Set(todos.map((b) => b.reservaId))).toEqual(new Set([reservaId]));
    expect(todos.every((b) => b.clienteNome === 'Maria Souza' && b.origem === 'equipe')).toBe(true);
    // A grade não lê telefone (CA-17).
    expect(JSON.stringify(v)).not.toContain('5511955550009');
  });

  it('CA-32: o detalhe do gestor lista os 3 itens por início, com status, ações próprias e o total', async () => {
    const { ce, carla, reservaId, itemIds, cli } = await cenarioCa6();
    const d = await lerReservaDaAgenda(ce.ctxEquipe, reservaId, AGORA);
    expect(d).toMatchObject({
      id: reservaId,
      clienteId: cli,
      papel: 'gestor',
      status: 'confirmado',
      data: { ano: 2026, mes: 12, dia: 1 },
      total: { centavos: 20500, servicos: 3, rotulo: 'reserva' },
      temItemCancelado: false,
      // Às 12:00 só o item das 15:00 ainda pode ser cancelado (abaixo, o caso com 2+).
      podeCancelarTodos: false,
    });
    expect(d.itens.map((i) => [i.id, i.servicoNome, i.profissionalNome, i.precoCentavos, i.duracaoMin])).toEqual([
      [itemIds[0], 'A', 'Bia', 9000, 60],
      [itemIds[1], 'B', 'Ana', 7500, 40],
      [itemIds[2], 'Manicure', 'Carla', 4000, 45],
    ]);
    expect(d.itens[2]).toMatchObject({ profissionalId: carla, encaixe: true, inicio: hora('15:00'), fim: hora('15:45') });
    // AGORA = 12:00 local: 09:00 e 10:00 já começaram e terminaram (não cancela; conclui); 15:00 ainda não.
    expect(d.itens.map((i) => i.acoes)).toEqual([
      { remarcar: true, cancelar: false, concluir: true, naoCompareceu: true },
      { remarcar: true, cancelar: false, concluir: true, naoCompareceu: true },
      { remarcar: true, cancelar: true, concluir: false, naoCompareceu: false },
    ]);
  });

  it('podeCancelarTodos: só o gestor e só com 2+ itens canceláveis agora', async () => {
    const { ce, reservaId } = await cenarioCa6();
    // Às 09:30 local: o item das 09:00 está em andamento (cancelável), o das 10:00 e o das 15:00 também.
    expect((await lerReservaDaAgenda(ce.ctxEquipe, reservaId, hora('09:30'))).podeCancelarTodos).toBe(true);
    // Às 12:00 só o das 15:00 é cancelável: 1 item não basta.
    expect((await lerReservaDaAgenda(ce.ctxEquipe, reservaId, AGORA)).podeCancelarTodos).toBe(false);
    // O profissional nunca recebe "Cancelar todos" (ND-3).
    expect((await lerReservaDaAgenda(ctxDaAna(ce), reservaId, hora('09:30'))).podeCancelarTodos).toBe(false);
  });

  it('CA-33: a profissional do meio vê só o bloco e o item dela, sem posição e sem dados dos outros itens', async () => {
    const { ce, carla, reservaId, itemIds } = await cenarioCa6();
    const ctx = ctxDaAna(ce);
    const v = await consultarAgenda(ctx, { data: DIA }, AGORA);
    expect(v.colunas.map((col) => col.id)).toEqual([ce.ana]);
    expect(v.colunas[0].blocos).toMatchObject([{ itemId: itemIds[1], reservaId, servicoNome: 'B', posicao: null }]);
    const d = await lerReservaDaAgenda(ctx, reservaId, AGORA);
    expect(d.papel).toBe('profissional');
    expect(d.itens.map((i) => i.id)).toEqual([itemIds[1]]);
    expect(d.total).toEqual({ centavos: 7500, servicos: 1, rotulo: 'seus_servicos' });
    expect(d.podeCancelarTodos).toBe(false);
    for (const texto of [JSON.stringify(v), JSON.stringify(d)]) {
      for (const vazado of [itemIds[0], itemIds[2], ce.bia, carla, '"A"', 'Manicure', 'Bia', 'Carla', '9000', '4000', '20500', hora('09:00').toISOString(), hora('15:00').toISOString()]) {
        expect(texto).not.toContain(vazado);
      }
    }
  });

  it('CA-33: profissional sem item na reserva → NaoEncontrado, igual a inexistente; com item cancelado, abre', async () => {
    const { ce, reservaId } = await cenarioCa6({ status: ['confirmado', 'cancelado', 'confirmado'] });
    const semItem = await reservar(c, ce, { profissionalId: ce.bia, inicio: hora('17:00') });
    await expect(lerReservaDaAgenda(ctxDaAna(ce), semItem, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
    const d = await lerReservaDaAgenda(ctxDaAna(ce), reservaId, AGORA);
    expect(d.itens.map((i) => i.status)).toEqual(['cancelado']);
    // Reserva não cancelada; o item visível está cancelado: soma 0 dos dela, rótulo "seus serviços".
    expect(d).toMatchObject({ status: 'confirmado', temItemCancelado: true, total: { centavos: 0, servicos: 0, rotulo: 'seus_servicos' } });
    expect(d.itens[0].acoes).toEqual({ remarcar: false, cancelar: false, concluir: false, naoCompareceu: false });
  });

  it('RN-35: item cancelado fica fora do total; reserva toda cancelada soma todos com o rótulo de cancelada', async () => {
    const parcial = await cenarioCa6({ status: ['confirmado', 'cancelado', 'confirmado'] });
    const d = await lerReservaDaAgenda(parcial.ce.ctxEquipe, parcial.reservaId, AGORA);
    expect(d).toMatchObject({ status: 'confirmado', temItemCancelado: true, total: { centavos: 13000, servicos: 2, rotulo: 'reserva' } });
    // O bloco do item cancelado continua na grade (RN-36), sem posição; os outros contam "n de 2".
    const v = await consultarAgenda(parcial.ce.ctxEquipe, { data: DIA }, AGORA);
    const pos = Object.fromEntries(v.colunas.flatMap((col) => col.blocos).map((b) => [b.itemId, [b.status, b.posicao]]));
    expect(pos).toEqual({
      [parcial.itemIds[0]]: ['confirmado', { n: 1, de: 2 }],
      [parcial.itemIds[1]]: ['cancelado', null],
      [parcial.itemIds[2]]: ['confirmado', { n: 2, de: 2 }],
    });

    const toda = await cenarioCa6({ status: ['cancelado', 'cancelado', 'cancelado'] });
    const dc = await lerReservaDaAgenda(toda.ce.ctxEquipe, toda.reservaId, AGORA);
    expect(dc).toMatchObject({ status: 'cancelado', temItemCancelado: true, podeCancelarTodos: false, total: { centavos: 20500, servicos: 3, rotulo: 'cancelada' } });
    expect((await lerReservaDaAgenda(ctxDaAna(toda.ce), toda.reservaId, AGORA)).total).toEqual({ centavos: 7500, servicos: 1, rotulo: 'cancelada' });
  });

  it('status derivado concluído com item "não compareceu": o detalhe mostra o derivado e cada item com o seu', async () => {
    const { ce, reservaId } = await cenarioCa6({ status: ['concluido', 'nao_compareceu', 'concluido'] });
    const d = await lerReservaDaAgenda(ce.ctxEquipe, reservaId, AGORA);
    expect(d.status).toBe('concluido');
    expect(d.itens.map((i) => i.status)).toEqual(['concluido', 'nao_compareceu', 'concluido']);
    expect(d.itens[1].acoes).toEqual({ remarcar: false, cancelar: false, concluir: true, naoCompareceu: false });
    expect(d.total).toEqual({ centavos: 20500, servicos: 3, rotulo: 'reserva' });
  });

  it('a data do detalhe é a do salão (fuso), não a do processo: 01:30Z do dia 2 ainda é dia 1 em São Paulo', async () => {
    const ce = await criarCenario();
    const id = await reservar(c, ce, { profissionalId: ce.ana, inicio: new Date('2026-12-02T01:30:00Z') });
    expect((await lerReservaDaAgenda(ce.ctxEquipe, id, AGORA)).data).toEqual({ ano: 2026, mes: 12, dia: 1 });
  });
});
