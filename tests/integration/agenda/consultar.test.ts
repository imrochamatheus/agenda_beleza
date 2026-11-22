import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultarAgenda, lerReservaDaAgenda } from '@/server/agenda/consultar';
import { LIMITES_AGENDA } from '@/server/agenda/tipos';
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
    expect(ana.reservas.map((r) => r.id)).toEqual([ra]);
    expect(bia.reservas.map((r) => r.id)).toEqual([rb]);
    expect(ana.bloqueios.map((b) => b.id).sort()).toEqual([bAna, bSalao].sort());
    expect(bia.bloqueios.map((b) => b.id).sort()).toEqual([bBia, bSalao].sort());
    expect(ana.bloqueios.find((b) => b.id === bAna)!.motivo).toBe('Dentista');
    // Opções do filtro: todos os profissionais do salão, inclusive o inativo da fábrica.
    expect(todos.profissionais.map((p) => p.id)).toEqual(expect.arrayContaining([ce.ana, ce.bia, ce.s.profissionalInativoId]));

    const so = await consultarAgenda(ce.ctxEquipe, { data: DIA, profissional: ce.ana }, AGORA);
    expect(ids(so)).toEqual([ce.ana]);
    expect(so.colunas[0].reservas.map((r) => r.id)).toEqual([ra]);
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
      expect(v.colunas[0].reservas.map((r) => r.id)).toEqual([ra]);
      expect(v.colunas[0].bloqueios.map((b) => b.id)).toEqual([bSalao]);
      expect(v.profissionais).toEqual([]);
      expect(v.profissionalFiltro).toBe(ce.ana);
      expect(JSON.stringify(v)).not.toContain('Segredo da Bia');
    }
    expect((await lerReservaDaAgenda(ctx, ra)).id).toBe(ra);
    await expect(lerReservaDaAgenda(ctx, rb)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerReservaDaAgenda(ctx, UUID_INEXISTENTE)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerReservaDaAgenda(ctx, 'lixo')).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('operação negada e perfil ausente → AcessoNegado', async () => {
    const ce = await criarCenario();
    const semPerfil = criarTenantContext({ usuarioId: ce.s.profissional.usuarioId, papel: 'profissional', salaoId: ce.s.salaoId, profissionalId: null });
    await expect(consultarAgenda(semPerfil, {}, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(lerReservaDaAgenda(semPerfil, UUID_INEXISTENTE)).rejects.toBeInstanceOf(AcessoNegado);
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
    const r = v.colunas[0].reservas[0];
    expect(r.clienteNome).toBeNull();
    expect(r.itens).toEqual([
      { nome: 'A', precoCentavos: 5000, duracaoMin: 30 },
      { nome: 'B', precoCentavos: 7000, duracaoMin: 45 },
    ]);
    const d = await lerReservaDaAgenda(ce.ctxEquipe, id);
    expect(d).toMatchObject({ clienteNome: null, anonimizada: true, contato: null, totalCentavos: 12000, duracaoTotalMin: 75 });
    expect(JSON.stringify([v, d])).not.toMatch(/Fulana|5511955550001/);
  });

  it('profissional inativo: o gestor vê a reserva passada com o nome e a marca de inativo (CA-6)', async () => {
    const ce = await criarCenario();
    const id = await reservar(c, ce, { profissionalId: ce.bia, inicio: hora('09:00', -3), status: 'concluido' });
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [ce.bia]);
    const v = await consultarAgenda(ce.ctxEquipe, { data: '2026-11-28' }, AGORA);
    const col = v.colunas.find((x) => x.id === ce.bia)!;
    expect(col).toMatchObject({ nome: 'Bia', ativo: false });
    expect(col.reservas.map((r) => r.id)).toEqual([id]);
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
    expect(Object.fromEntries(v.colunas[0].reservas.map((r) => [r.id, r.status]))).toEqual(porStatus);
  });

  it('encaixe sobreposto no mesmo profissional aparece junto (sem esconder)', async () => {
    const ce = await criarCenario();
    await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00') });
    await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:30'), status: 'cancelado', encaixe: true });
    const v = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    expect(v.colunas[0].reservas).toHaveLength(2);
    expect(v.colunas[0].reservas.some((r) => r.encaixe)).toBe(true);
  });
});

describe('detalhe: contato (CA-17) e campos', () => {
  it('gestor e a profissional da reserva recebem o telefone; sem lista de mensagens no DTO', async () => {
    const ce = await criarCenario();
    const cli = await inserirCliente(c, ce.s.salaoId, 'Maria', '+5511955550002');
    const id = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('10:00'), clienteId: cli });
    for (const ctx of [ce.ctxEquipe, ctxDaAna(ce)]) {
      const d = await lerReservaDaAgenda(ctx, id);
      expect(d).toMatchObject({
        id,
        fuso: 'America/Sao_Paulo',
        profissional: { id: ce.ana, nome: 'Ana', ativo: true },
        clienteNome: 'Maria',
        anonimizada: false,
        contato: { telefoneE164: '+5511955550002' },
        status: 'confirmado',
        origem: 'equipe',
        encaixe: false,
        totalCentavos: 5000,
        duracaoTotalMin: 60,
      });
      expect(d.inicio).toEqual(hora('10:00'));
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
      expect(v.colunas.find((x) => x.id === ce.ana)!.reservas.map((r) => r.id)).toEqual([id]);
      expect((await lerReservaDaAgenda(ctx, id)).id).toBe(id);
    }
  });
});

describe('CA-13 e RN-2: período no fuso do salão', () => {
  it('reserva 23:00–01:00 aparece nos dois dias; a semana começa no domingo', async () => {
    const ce = await criarCenario();
    const id = await reservar(c, ce, { profissionalId: ce.ana, inicio: hora('23:00'), fim: hora('01:00', 1) });
    for (const data of [DIA, '2026-12-02']) {
      const v = await consultarAgenda(ce.ctxEquipe, { data }, AGORA);
      expect(v.colunas.find((x) => x.id === ce.ana)!.reservas.map((r) => r.id)).toEqual([id]);
    }
    const dia3 = await consultarAgenda(ce.ctxEquipe, { data: '2026-12-03' }, AGORA);
    expect(dia3.colunas.find((x) => x.id === ce.ana)!.reservas).toEqual([]);
    const sem = await consultarAgenda(ce.ctxEquipe, { data: '2026-12-02', visao: 'semana' }, AGORA);
    expect(sem.dias.map((d) => d.iso)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
    expect(sem.colunas.find((x) => x.id === ce.ana)!.reservas.map((r) => r.id)).toEqual([id]);
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
    expect(fechado.colunas[0].reservas).toHaveLength(1); // reserva fora do funcionamento continua visível
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

describe('truncamento (R-1)', () => {
  it('mais de 200 reservas no período: 200 e truncada', async () => {
    const ce = await criarCenario();
    const cli = await inserirCliente(c, ce.s.salaoId, 'Muitas');
    await c.query(
      `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4::timestamptz + g * interval '1 minute', $4::timestamptz + (g + 1) * interval '1 minute',
              $4::timestamptz + (g + 1) * interval '1 minute', 'cancelado', 'equipe'
         FROM generate_series(0, 200) g`,
      [ce.s.salaoId, ce.ana, cli, hora('08:00')],
    );
    const v = await consultarAgenda(ce.ctxEquipe, { data: DIA }, AGORA);
    expect(v.colunas[0].reservas).toHaveLength(LIMITES_AGENDA.reservas);
    expect(v.truncada).toBe(true);
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

  it('1 reserva e 1 profissional × 50 reservas e 5 profissionais, dia e semana: mesma contagem (6)', async () => {
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
          { servicoId: muito.B, precoCentavos: 7000, duracaoMin: 30 },
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
    expect(v.colunas.reduce((t, x) => t + x.reservas.length, 0)).toBe(50);
  });
});
