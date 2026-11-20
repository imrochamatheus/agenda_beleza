import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { salvarJornada } from '@/server/jornadas/jornadas.acao';
import { MENSAGENS_JORNADA } from '@/server/jornadas/tipos';
import { desativarProfissional, reativarProfissional } from '@/server/profissionais/profissionais.acao';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';
import { cancelarReservasDoSalao } from '../profissionais/apoio';

import { apagarJornada, contarMensagens, faixasJornada, fotografiaReservas, linhasJornada, semana } from './apoio';
import type { SemanaTexto } from './apoio';

// D-015 T-3: salvar a jornada pela ação (defineAcao), com PostgreSQL real.
// CA-1, CA-2, CA-4..CA-10, CA-14, CA-16 e a idempotência (D-13).

const M = MENSAGENS_JORNADA;
const DIA_MS = 24 * 60 * 60 * 1000;

let c: pg.Client;
let s: SalaoCompleto;
let gestor: Credencial;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
  gestor = await credencialDoGestor(s);
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function salvar(profissionalId: string, dias: SemanaTexto, credencial = gestor) {
  return salvarJornada.executar(credencial, semana(profissionalId, dias));
}

/** Resultado inválido da ação → os erros. */
async function errosAoSalvar(profissionalId: string, dias: SemanaTexto) {
  const r = await salvar(profissionalId, dias);
  if (!r.ok || r.dados.resultado !== 'invalido') throw new Error(`esperava inválido: ${JSON.stringify(r)}`);
  return r.dados.erros;
}

/** Profissional novo do salão, ativo e sem jornada. */
async function profissionalSemJornada(salaoId = s.salaoId): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    "INSERT INTO profissional (salao_id, nome) VALUES ($1, 'Sem jornada') RETURNING id::text AS id",
    [salaoId],
  );
  return rows[0].id;
}

describe('CA-1: gravar segunda 09:00–12:00 e 13:00–18:00', () => {
  it('CA-1: exatamente duas linhas (1, 540, 720) e (1, 780, 1080) e a pausa 12:00–13:00 no resultado', async () => {
    const id = await profissionalSemJornada();
    const log = vi.mocked(console.info);
    const r = await salvar(id, { 1: [['09:00', '12:00'], ['13:00', '18:00']] });
    expect(r.ok).toBe(true);
    if (!r.ok || r.dados.resultado !== 'salvo') throw new Error('esperava salvo');
    expect(r.dados.inseridos).toBe(2);
    expect(r.dados.removidos).toBe(0);
    expect(r.dados.semana[1]).toEqual({
      diaSemana: 1,
      intervalos: [
        { inicioMin: 540, fimMin: 720 },
        { inicioMin: 780, fimMin: 1080 },
      ],
      pausas: [{ inicioMin: 720, fimMin: 780 }],
    });
    expect(r.dados.semana.filter((d) => d.diaSemana !== 1).every((d) => d.intervalos.length === 0)).toBe(true);
    expect(await faixasJornada(c, id)).toEqual([
      [1, 540, 720],
      [1, 780, 1080],
    ]);
    // Log de uma linha só com ids e contagens.
    const evento = log.mock.calls.map(([l]) => JSON.parse(String(l))).find((l) => l.evento === 'jornada.salva');
    expect(evento).toEqual({ evento: 'jornada.salva', salaoId: s.salaoId, profissionalId: id, inseridos: 2, removidos: 0, intervalos: 2 });
  });
});

describe('recusas: nada é gravado', () => {
  it('CA-2: sobrepostos na mesma segunda → erro nas duas linhas e jornada anterior idêntica (mesmos ids)', async () => {
    const id = s.profissional.profissionalId;
    const antes = await linhasJornada(c, id);
    expect(await errosAoSalvar(id, { 1: [['09:00', '12:00'], ['11:00', '14:00']] })).toEqual({
      dias: { 1: { intervalos: { 0: { intervalo: M.sobreposicao }, 1: { intervalo: M.sobreposicao } } } },
    });
    expect(await linhasJornada(c, id)).toEqual(antes);
  });

  it('CA-4: 22:00–02:00 e 10:00–10:00 → ordem; nada gravado', async () => {
    const id = s.profissional.profissionalId;
    const antes = await linhasJornada(c, id);
    expect(await errosAoSalvar(id, { 5: [['22:00', '02:00']] })).toEqual({ dias: { 5: { intervalos: { 0: { intervalo: M.ordem } } } } });
    expect(await errosAoSalvar(id, { 2: [['10:00', '10:00']] })).toEqual({ dias: { 2: { intervalos: { 0: { intervalo: M.ordem } } } } });
    expect(await linhasJornada(c, id)).toEqual(antes);
  });

  it('CA-5: início 24:00, fim 24:05 ou 25:00 → recusados', async () => {
    const id = s.profissional.profissionalId;
    const antes = await linhasJornada(c, id);
    expect(await errosAoSalvar(id, { 0: [['24:00', '24:00'], ['22:00', '24:05'], ['22:00', '25:00']] })).toEqual({
      dias: { 0: { intervalos: { 0: { inicio: M.inicio24 }, 1: { fim: M.formato }, 2: { fim: M.formato } } } },
    });
    expect(await linhasJornada(c, id)).toEqual(antes);
  });

  it('CA-6: 09:07 → granularidade; 9h, 12:60, só um campo → erro de campo; nada gravado', async () => {
    const id = s.profissional.profissionalId;
    const antes = await linhasJornada(c, id);
    expect(await errosAoSalvar(id, { 1: [['09:07', '12:00'], ['9h', '12:60'], ['13:00', '']] })).toEqual({
      dias: { 1: { intervalos: { 0: { inicio: M.granularidade }, 1: { inicio: M.formato, fim: M.formato }, 2: { fim: M.faltaFim } } } },
    });
    expect(await linhasJornada(c, id)).toEqual(antes);
  });

  it('CA-9: 7 intervalos válidos num dia → limite; nada gravado', async () => {
    const id = s.profissional.profissionalId;
    const antes = await linhasJornada(c, id);
    const sete: [string, string][] = [8, 10, 12, 14, 16, 18, 20].map((h) => [`${h}:00`, `${h}:30`]);
    expect(await errosAoSalvar(id, { 4: sete })).toEqual({ dias: { 4: { dia: M.limite } } });
    expect(await linhasJornada(c, id)).toEqual(antes);
  });

  it('entrada malformada (6 dias, campo extra) → formulario; nada gravado', async () => {
    const id = s.profissional.profissionalId;
    const antes = await linhasJornada(c, id);
    const seis = { profissionalId: id, dias: semana(id).dias.slice(0, 6) };
    expect(await salvarJornada.executar(gestor, seis)).toEqual({
      ok: true,
      dados: { resultado: 'invalido', erros: { formulario: M.formulario } },
    });
    expect(await salvarJornada.executar(gestor, null as never)).toMatchObject({ ok: true, dados: { resultado: 'invalido' } });
    expect(await linhasJornada(c, id)).toEqual(antes);
  });
});

describe('aceitos', () => {
  it('CA-5: 22:00–24:00 gravado como (1320, 1440); 00:00–02:00 no dia seguinte', async () => {
    const id = await profissionalSemJornada();
    expect(await salvar(id, { 5: [['22:00', '24:00']], 6: [['00:00', '02:00']] })).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
    expect(await faixasJornada(c, id)).toEqual([
      [5, 1320, 1440],
      [6, 0, 120],
    ]);
  });

  it('CA-7: 09:00–12:00 + 12:00–13:00 na terça → uma linha (540, 780); fora de ordem → ordenados', async () => {
    const id = await profissionalSemJornada();
    await salvar(id, { 2: [['12:00', '13:00'], ['09:00', '12:00']], 3: [['15:00', '16:00'], ['08:00', '09:00']] });
    expect(await faixasJornada(c, id)).toEqual([
      [2, 540, 780],
      [3, 480, 540],
      [3, 900, 960],
    ]);
  });

  it('CA-8: jornada de segunda a sábado → salvar só quarta 10:00–16:00 deixa só a quarta', async () => {
    const outro = await criarSalaoCompleto();
    const id = outro.profissional.profissionalId;
    expect((await linhasJornada(c, id)).length).toBe(12);
    const r = await salvar(id, { 3: [['10:00', '16:00']] }, await credencialDoGestor(outro));
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo', inseridos: 1, removidos: 12 } });
    expect(await faixasJornada(c, id)).toEqual([[3, 600, 960]]);
  });

  it('CA-8: um único dia inválido → nenhum dia é alterado', async () => {
    const id = s.profissional.profissionalId;
    const antes = await linhasJornada(c, id);
    expect(await errosAoSalvar(id, { 1: [['10:00', '11:00']], 2: [['10:00', '11:00']], 3: [['10:00', '09:00']] })).toEqual({
      dias: { 3: { intervalos: { 0: { intervalo: M.ordem } } } },
    });
    expect(await linhasJornada(c, id)).toEqual(antes);
  });

  it('D-13: salvar a mesma semana é idempotente: nenhuma escrita e os mesmos ids', async () => {
    const outro = await criarSalaoCompleto();
    const id = outro.profissional.profissionalId;
    const credencial = await credencialDoGestor(outro);
    const antes = await linhasJornada(c, id);
    const padrao: SemanaTexto = Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((d) => [d, [['09:00', '12:00'], ['13:00', '18:00']]]),
    );
    expect(await salvar(id, padrao, credencial)).toMatchObject({ ok: true, dados: { resultado: 'salvo', inseridos: 0, removidos: 0 } });
    expect(await linhasJornada(c, id)).toEqual(antes);
    // Mudança parcial preserva os ids dos intervalos mantidos.
    expect(await salvar(id, { ...padrao, 6: [['09:00', '12:00']] }, credencial)).toMatchObject({
      ok: true,
      dados: { inseridos: 0, removidos: 1 },
    });
    const depois = await linhasJornada(c, id);
    expect(depois).toEqual(antes.filter((l) => !(l.dia_semana === 6 && l.inicio_min === 780)));
  });

  it('semana toda de folga → remove todas as linhas', async () => {
    const outro = await criarSalaoCompleto();
    const id = outro.profissional.profissionalId;
    expect(await salvar(id, {}, await credencialDoGestor(outro))).toMatchObject({ ok: true, dados: { removidos: 12, inseridos: 0 } });
    expect(await linhasJornada(c, id)).toEqual([]);
  });
});

describe('CA-10: reservas e mensagens não são tocadas', () => {
  it('CA-10: quinta 15:00 local (18:00 UTC) confirmada; quinta vira folga → reserva igual byte a byte e nenhuma mensagem', async () => {
    // Próxima quinta-feira (UTC) a pelo menos 7 dias, 18:00 UTC = 15:00 em America/Sao_Paulo.
    const base = new Date(Date.now() + 7 * DIA_MS);
    const ate = (4 - base.getUTCDay() + 7) % 7;
    const quinta = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + ate, 18, 0));
    const outro = await criarSalaoCompleto({ reserva: { inicio: quinta } });
    const antes = await fotografiaReservas(c, outro.salaoId);
    const mensagens = await contarMensagens(c);
    const id = outro.profissional.profissionalId;
    const padrao: SemanaTexto = Object.fromEntries(
      [1, 2, 3, 5, 6].map((d) => [d, [['09:00', '12:00'], ['13:00', '18:00']]]),
    );
    expect(await salvar(id, padrao, await credencialDoGestor(outro))).toMatchObject({ ok: true, dados: { resultado: 'salvo', removidos: 2 } });
    expect((await faixasJornada(c, id)).some(([d]) => d === 4)).toBe(false);
    expect(await fotografiaReservas(c, outro.salaoId)).toEqual(antes);
    expect((antes.reservas[0] as { status: string }).status).toBe('confirmado');
    expect(await contarMensagens(c)).toBe(mensagens);
  });
});

describe('CA-14: profissional inativo', () => {
  it('CA-14: o gestor salva a jornada de um inativo; desativar e reativar não alteram as linhas', async () => {
    const outro = await criarSalaoCompleto();
    const credencial = await credencialDoGestor(outro);
    // Inativo da fábrica (sem jornada): salvar é aceito (RN-13).
    expect(await salvar(outro.profissionalInativoId, { 2: [['10:00', '14:00']] }, credencial)).toMatchObject({
      ok: true,
      dados: { resultado: 'salvo', inseridos: 1 },
    });
    expect(await faixasJornada(c, outro.profissionalInativoId)).toEqual([[2, 600, 840]]);

    // Ativo com jornada: desativar (sem reservas futuras) e reativar pelas ações da D-013.
    await cancelarReservasDoSalao(c, outro.salaoId);
    const id = outro.profissional.profissionalId;
    const antes = await linhasJornada(c, id);
    expect(await desativarProfissional.executar(credencial, { id })).toEqual({ ok: true, dados: { resultado: 'desativado' } });
    expect(await linhasJornada(c, id)).toEqual(antes);
    expect(await reativarProfissional.executar(credencial, { id })).toEqual({ ok: true, dados: { resultado: 'reativado' } });
    expect(await linhasJornada(c, id)).toEqual(antes);
  });
});

describe('CA-16: hora de parede, sem conversão por fuso', () => {
  it.each(['America/Manaus', 'America/Sao_Paulo'])('CA-16: fuso %s → 09:00 gravado como 540', async (fuso) => {
    const outro = await criarSalaoCompleto({ salao: { fuso } });
    const id = outro.profissional.profissionalId;
    await salvar(id, { 1: [['09:00', '12:00']] }, await credencialDoGestor(outro));
    expect(await faixasJornada(c, id)).toEqual([[1, 540, 720]]);
  });
});

describe('sem jornada', () => {
  it('profissional cuja jornada foi apagada recebe a nova semana normalmente', async () => {
    const id = s.gestor.profissionalId!;
    await apagarJornada(c, id);
    expect(await salvar(id, { 0: [['08:00', '09:00']] })).toMatchObject({ ok: true, dados: { inseridos: 1, removidos: 0 } });
    expect(await faixasJornada(c, id)).toEqual([[0, 480, 540]]);
  });
});
