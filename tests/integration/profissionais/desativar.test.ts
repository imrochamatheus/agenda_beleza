import type pg from 'pg';
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { entrar, MENSAGENS_LOGIN } from '@/server/auth/login';
import { repos } from '@/server/repos';
import { listarProfissionaisPublicos, resolverSalaoPorSlug } from '@/server/repos/publico';
import {
  criarProfissional,
  desativarProfissional,
  reativarProfissional,
} from '@/server/profissionais/profissionais.acao';
import { MENSAGENS_PROFISSIONAL, ROTULO_CLIENTE_REMOVIDA } from '@/server/profissionais/tipos';
import { resolverTenant } from '@/server/tenant/sessao';
import type { Credencial } from '@/server/tenant/sessao';

import { criarSessao, credencialDoProfissional, entrarDeVerdade } from '../../support/auth';
import { SENHA_DE_TESTE, criarDoisSaloes, criarSalaoCompleto, instanteFuturo } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, inserirReservaComItens as inserirReservaComItensSql } from '../../support/sql';

import {
  MIN_MS,
  cancelarReservas,
  cancelarReservasDoSalao,
  ctxDoGestor,
  fotografiaDoSalao,
  inserirConvite,
  inserirReservaComItens,
  linhaProfissional,
  sessoesDe,
} from './apoio';

// D-013 T-3: desativar e reativar pelas ações, com PostgreSQL real e relógio injetado.
// CA-3, CA-4, CA-5, CA-7, CA-8 e CA-15 (RN-1, RN-2, RN-7, RN-8, RN-10).

const DIA_MS = 24 * 60 * 60 * 1000;

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
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

/** Credencial do gestor válida para relógios injetados até ~20 dias à frente. */
async function gestorDe(s: SalaoCompleto): Promise<Credencial> {
  return (await criarSessao(s.gestor.usuarioId, { expiraEm: new Date(Date.now() + 20 * DIA_MS) })).credencial;
}

async function novoProfissional(s: SalaoCompleto, nome: string): Promise<string> {
  const r = await criarProfissional.executar(await gestorDe(s), { nome });
  if (!r.ok || r.dados.resultado !== 'salvo') throw new Error('falha ao criar profissional');
  return r.dados.profissional.id;
}

/** "dd/mm/aaaa HH:mm" em America/Sao_Paulo (UTC−3, sem horário de verão desde 2019), sem format.ts. */
function emSaoPaulo(instante: Date): string {
  const d = new Date(instante.getTime() - 3 * 60 * MIN_MS);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}`;
}

describe('CA-3: recusa com reservas futuras confirmadas', () => {
  it('CA-3: lista as duas confirmadas por início (fuso do salão, serviços, "cliente removida"); nada muda', async () => {
    const s = await criarSalaoCompleto();
    const id = await novoProfissional(s, 'Ana');
    const gestor = await gestorDe(s);
    const [serv1, serv2] = s.servicos.ativos;
    // 02:30Z = 23:30 do dia anterior em São Paulo (virada de dia).
    const madrugada = instanteFuturo(3, 2, 30);
    const tarde = instanteFuturo(4, 15);
    const base = { salaoId: s.salaoId, profissionalId: id, clienteId: s.clientes.ativaId };
    const r2 = await inserirReservaComItens(c, {
      ...base,
      clienteId: s.clientes.anonimizadaId,
      inicio: tarde,
      fim: new Date(tarde.getTime() + 30 * MIN_MS),
      servicoIds: [serv2],
    });
    const r1 = await inserirReservaComItens(c, {
      ...base,
      inicio: madrugada,
      fim: new Date(madrugada.getTime() + 90 * MIN_MS),
      servicoIds: [serv1, serv2],
    });
    await inserirReservaComItens(c, {
      ...base,
      inicio: instanteFuturo(2, 15),
      fim: instanteFuturo(2, 16),
      status: 'cancelado',
      servicoIds: [serv1],
    });
    await inserirConvite(c, { salaoId: s.salaoId, profissionalId: id, estado: 'pendente' });
    await criarSessao(s.gestor.usuarioId);
    const antes = await fotografiaDoSalao(c, s.salaoId);

    const r = await desativarProfissional.executar(gestor, { id });
    // Segundo item de r1: 1 min, logo depois dos 89 min do primeiro (apoio.inserirReservaComItens).
    const segundoItem = new Date(madrugada.getTime() + 89 * MIN_MS);
    const itensDe = async (reservaId: string) =>
      (await c.query<{ id: string }>('SELECT id::text AS id FROM reserva_item WHERE reserva_id = $1 ORDER BY inicio', [reservaId])).rows.map((x) => x.id);
    const [i1a, i1b] = await itensDe(r1);
    const [i2] = await itensDe(r2);

    expect(r).toEqual({
      ok: true,
      dados: {
        resultado: 'recusado',
        // D-050 RN-38: uma linha por ITEM confirmado futuro (r1 tem dois itens do profissional).
        reservas: [
          {
            id: r1,
            itemId: i1a,
            inicio: madrugada.toISOString(),
            inicioLocal: emSaoPaulo(madrugada),
            servicos: [s.servicos.nomes[0]],
            cliente: s.clientes.nomeAtiva,
          },
          {
            id: r1,
            itemId: i1b,
            inicio: segundoItem.toISOString(),
            inicioLocal: emSaoPaulo(segundoItem),
            servicos: [s.servicos.nomes[1]],
            cliente: s.clientes.nomeAtiva,
          },
          {
            id: r2,
            itemId: i2,
            inicio: tarde.toISOString(),
            inicioLocal: emSaoPaulo(tarde),
            servicos: [s.servicos.nomes[1]],
            cliente: ROTULO_CLIENTE_REMOVIDA,
          },
        ],
      },
    });
    // Chave única por linha (a lista da UI usa itemId como key).
    expect(new Set([i1a, i1b, i2]).size).toBe(3);
    expect(emSaoPaulo(madrugada)).toMatch(/ 23:30$/);
    expect(emSaoPaulo(madrugada).slice(0, 10)).not.toBe(
      `${String(madrugada.getUTCDate()).padStart(2, '0')}/${String(madrugada.getUTCMonth() + 1).padStart(2, '0')}/${madrugada.getUTCFullYear()}`,
    );
    expect((await linhaProfissional(c, id))!.ativo).toBe(true);
    expect(await fotografiaDoSalao(c, s.salaoId)).toEqual(antes);
    expect(MENSAGENS_PROFISSIONAL.recusaDesativacao).toContain('reservas futuras confirmadas');
  });

  it('CA-3: log da recusa traz só ids e a quantidade (sem nomes nem telefones)', async () => {
    const s = await criarSalaoCompleto();
    const linhas: string[] = [];
    vi.mocked(console.info).mockImplementation((l: string) => {
      linhas.push(l);
    });
    // A reserva da fábrica (confirmada, +7 dias, 2 itens do profissional) bloqueia o profissional da
    // fábrica; D-050: a quantidade conta ITENS.
    const r = await desativarProfissional.executar(await gestorDe(s), { id: s.profissional.profissionalId });
    expect(r.ok && r.dados.resultado).toBe('recusado');
    expect(linhas.map((l) => JSON.parse(l))).toEqual([
      { evento: 'profissional.desativacao_recusada', salaoId: s.salaoId, profissionalId: s.profissional.profissionalId, quantidade: 2 },
    ]);
    expect(linhas.join()).not.toContain(s.clientes.nomeAtiva);
  });
});

describe('D-050 RN-38: bloqueio por ITEM, não pela reserva', () => {
  it('reserva com itens de dois profissionais: só o item confirmado de cada um conta', async () => {
    const s = await criarSalaoCompleto();
    const gestor = await gestorDe(s);
    const eva = await novoProfissional(s, 'Eva');
    const lia = await novoProfissional(s, 'Lia');
    const [serv1, serv2] = s.servicos.ativos;
    const inicio = instanteFuturo(6, 13);
    // Item de Eva confirmado; item de Lia (na MESMA reserva) cancelado.
    const { reservaId, itemIds } = await inserirReservaComItensSql(c, {
      salaoId: s.salaoId,
      clienteId: s.clientes.ativaId,
      origem: 'equipe',
      itens: [
        { profissionalId: eva, inicio, duracaoMin: 30, servicoId: serv1 },
        { profissionalId: lia, inicio: new Date(inicio.getTime() + 30 * MIN_MS), duracaoMin: 30, servicoId: serv2, status: 'cancelado' },
      ],
    });
    // Lia: o único item dela está cancelado → desativa, mesmo com a reserva confirmada.
    expect(await desativarProfissional.executar(gestor, { id: lia })).toEqual({ ok: true, dados: { resultado: 'desativado' } });
    // Eva: recusa listando só o item dela.
    const r = await desativarProfissional.executar(gestor, { id: eva });
    expect(r.ok && r.dados.resultado === 'recusado' && r.dados.reservas).toEqual([
      expect.objectContaining({ id: reservaId, inicio: inicio.toISOString(), servicos: [s.servicos.nomes[0]] }),
    ]);
    expect((await linhaProfissional(c, eva))!.ativo).toBe(true);
    // Item de Eva cancelado (a reserva fica cancelada) → desativa.
    await c.query(`UPDATE reserva_item SET status = 'cancelado' WHERE id = $1`, [itemIds[0]]);
    await c.query(`UPDATE reserva SET status = 'cancelado', cancelada_em = now() WHERE id = $1`, [reservaId]);
    expect(await desativarProfissional.executar(gestor, { id: eva })).toEqual({ ok: true, dados: { resultado: 'desativado' } });
  });
});

describe('CA-4: desativação preserva o histórico', () => {
  it('CA-4: ativo=false; some das consultas de ativos e da página pública; histórico mantém o profissional_id', async () => {
    const s = await criarSalaoCompleto();
    await cancelarReservasDoSalao(c, s.salaoId);
    const id = s.profissional.profissionalId;
    const passadaInicio = new Date(Date.now() - 3 * DIA_MS);
    const passada = await inserirReservaComItens(c, {
      salaoId: s.salaoId,
      profissionalId: id,
      clienteId: s.clientes.ativaId,
      inicio: passadaInicio,
      fim: new Date(passadaInicio.getTime() + 60 * MIN_MS),
      servicoIds: [s.servicos.ativos[0]],
    });
    const contar = async () =>
      (
        await c.query(
          `SELECT (SELECT count(*) FROM profissional)::int AS profissionais,
                  (SELECT count(DISTINCT reserva_id) FROM reserva_item WHERE profissional_id = $1)::int AS reservas,
                  (SELECT count(*) FROM jornada WHERE profissional_id = $1)::int AS jornadas,
                  (SELECT count(*) FROM servico_profissional WHERE profissional_id = $1)::int AS vinculos,
                  (SELECT count(*) FROM bloqueio WHERE profissional_id = $1)::int AS bloqueios,
                  (SELECT count(*) FROM reserva_item WHERE profissional_id = $1)::int AS itens`,
          [id],
        )
      ).rows[0];
    const antes = await contar();
    expect(antes.jornadas).toBeGreaterThan(0);
    expect(antes.vinculos).toBeGreaterThan(0);

    const r = await desativarProfissional.executar(await gestorDe(s), { id });

    expect(r).toEqual({ ok: true, dados: { resultado: 'desativado' } });
    expect((await linhaProfissional(c, id))!.ativo).toBe(false);
    expect(await contar()).toEqual(antes);
    const { rows } = await c.query('SELECT profissional_id::text AS p FROM reserva_item WHERE reserva_id = $1', [passada]);
    expect(rows.map((x) => x.p)).toEqual([id]);
    const { contexto } = await resolverSalaoPorSlug(s.slugAtual);
    expect((await listarProfissionaisPublicos(contexto)).map((p) => p.id)).not.toContain(id);
    expect((await repos().profissionais.listarAtivos(ctxDoGestor(s))).map((p) => p.id)).not.toContain(id);
    const painel = await repos().profissionais.listarParaPainel(ctxDoGestor(s));
    expect(painel.find((p) => p.id === id)).toMatchObject({ ativo: false });
  });
});

describe('CA-5 e CA-8: sessões do profissional', () => {
  it('CA-5: as duas sessões do usuário ficam revogadas (401); login recusado; outras sessões continuam válidas', async () => {
    const s = await criarSalaoCompleto();
    await cancelarReservasDoSalao(c, s.salaoId);
    const x = await entrarDeVerdade(s.profissional.email);
    const y = await entrarDeVerdade(s.profissional.email);
    const gestor = await gestorDe(s);
    const profB = await credencialDoProfissional(b);
    const gestorB = await gestorDe(b);
    const agora = new Date();

    expect(await desativarProfissional.executar(gestor, { id: s.profissional.profissionalId }, { agora })).toEqual({
      ok: true,
      dados: { resultado: 'desativado' },
    });

    const sessoes = await sessoesDe(c, s.profissional.usuarioId);
    expect(sessoes).toHaveLength(2);
    expect(sessoes.map((z) => z.revogada_em)).toEqual([agora, agora]);
    for (const cred of [x.credencial, y.credencial]) {
      await expect(resolverTenant(cred)).rejects.toMatchObject({ codigo: 'nao_autenticado', status: 401 });
    }
    const login = await entrar({ email: s.profissional.email, senha: SENHA_DE_TESTE }, { log: () => {} });
    expect(login).toMatchObject({ ok: false, mensagem: MENSAGENS_LOGIN.desativado });
    expect(MENSAGENS_LOGIN.desativado).toBe('Seu acesso está desativado. Fale com a gestão do salão.');
    expect((await resolverTenant(gestor)).papel).toBe('gestor');
    expect((await resolverTenant(profB)).salaoId).toBe(b.salaoId);
    expect((await resolverTenant(gestorB)).salaoId).toBe(b.salaoId);
  });

  it('CA-8: reativar → volta à página pública; sessões revogadas continuam revogadas; novo login resolve contexto', async () => {
    const s = await criarSalaoCompleto();
    await cancelarReservasDoSalao(c, s.salaoId);
    const antiga = await entrarDeVerdade(s.profissional.email);
    const gestor = await gestorDe(s);
    const id = s.profissional.profissionalId;
    await desativarProfissional.executar(gestor, { id });
    const revogadas = await sessoesDe(c, s.profissional.usuarioId);

    expect(await reativarProfissional.executar(gestor, { id })).toEqual({ ok: true, dados: { resultado: 'reativado' } });

    expect((await linhaProfissional(c, id))!.ativo).toBe(true);
    const { contexto } = await resolverSalaoPorSlug(s.slugAtual);
    expect((await listarProfissionaisPublicos(contexto)).map((p) => p.id)).toContain(id);
    expect(await sessoesDe(c, s.profissional.usuarioId)).toEqual(revogadas);
    await expect(resolverTenant(antiga.credencial)).rejects.toMatchObject({ status: 401 });
    const nova = await entrarDeVerdade(s.profissional.email);
    const ctx = await resolverTenant(nova.credencial);
    expect([ctx.papel, ctx.profissionalId]).toEqual(['profissional', id]);
  });
});

describe('CA-7: convites', () => {
  it('CA-7: só o convite pendente ganha invalidado_em = agora; reativar não o restaura', async () => {
    const s = await criarSalaoCompleto();
    const id = await novoProfissional(s, 'Lia');
    const pendente = await inserirConvite(c, { salaoId: s.salaoId, profissionalId: id, estado: 'pendente' });
    const aceito = await inserirConvite(c, { salaoId: s.salaoId, profissionalId: id, estado: 'aceito' });
    const invalidado = await inserirConvite(c, { salaoId: s.salaoId, profissionalId: id, estado: 'invalidado' });
    const outros = () =>
      c.query('SELECT id, aceito_em, invalidado_em FROM convite WHERE id = ANY($1) ORDER BY id', [[aceito, invalidado]]);
    const antes = (await outros()).rows;
    const agora = instanteFuturo(1, 10);
    const gestor = await gestorDe(s);

    expect(await desativarProfissional.executar(gestor, { id }, { agora })).toEqual({ ok: true, dados: { resultado: 'desativado' } });

    const { rows } = await c.query('SELECT invalidado_em FROM convite WHERE id = $1', [pendente]);
    expect(rows[0].invalidado_em).toEqual(agora);
    expect((await outros()).rows).toEqual(antes);
    await reativarProfissional.executar(gestor, { id });
    expect((await c.query('SELECT invalidado_em FROM convite WHERE id = $1', [pendente])).rows[0].invalidado_em).toEqual(agora);
  });

  it('D-18: desativar quem já está inativo reaplica os efeitos (idempotente) e registra o evento', async () => {
    const s = await criarSalaoCompleto();
    const linhas: string[] = [];
    vi.mocked(console.info).mockImplementation((l: string) => {
      linhas.push(l);
    });
    const id = s.profissionalInativoId;
    const pendente = await inserirConvite(c, { salaoId: s.salaoId, profissionalId: id, estado: 'pendente' });
    expect(await desativarProfissional.executar(await gestorDe(s), { id })).toEqual({ ok: true, dados: { resultado: 'desativado' } });
    expect((await c.query('SELECT invalidado_em FROM convite WHERE id = $1', [pendente])).rows[0].invalidado_em).not.toBeNull();
    expect(linhas.map((l) => JSON.parse(l))).toEqual([
      { evento: 'profissional.desativado', salaoId: s.salaoId, profissionalId: id, sessoesRevogadas: 0, convitesInvalidados: 1 },
    ]);
  });
});

describe('CA-15: fronteira de tempo com relógio injetado', () => {
  it('CA-15: terminada há 1 min não bloqueia; em andamento e começando em 1 min bloqueiam', async () => {
    const s = await criarSalaoCompleto();
    const id = await novoProfissional(s, 'Nina');
    const gestor = await gestorDe(s);
    const agora = instanteFuturo(2, 12);
    const em = (min: number) => new Date(agora.getTime() + min * MIN_MS);
    const base = { salaoId: s.salaoId, profissionalId: id, clienteId: s.clientes.ativaId, servicoIds: [s.servicos.ativos[0]] };
    const passada = await inserirReservaComItens(c, { ...base, inicio: em(-61), fim: em(-1) });
    // Em andamento: [agora − 1 min, agora + 1 min), adjacente à passada (o R-9 do desenho sobrepunha
    // [−30, +1) a [−61, −1), o que a exclusion constraint recusa).
    const andamento = await inserirReservaComItens(c, { ...base, inicio: em(-1), fim: em(1) });
    const proxima = await inserirReservaComItens(c, { ...base, inicio: em(1), fim: em(31) });

    const r = await desativarProfissional.executar(gestor, { id }, { agora });
    expect(r.ok && r.dados.resultado === 'recusado' && r.dados.reservas.map((x) => x.id)).toEqual([andamento, proxima]);
    expect((await linhaProfissional(c, id))!.ativo).toBe(true);

    await cancelarReservas(c, [andamento, proxima]);
    expect(await desativarProfissional.executar(gestor, { id }, { agora })).toEqual({ ok: true, dados: { resultado: 'desativado' } });
    expect((await c.query('SELECT status FROM reserva WHERE id = $1', [passada])).rows[0].status).toBe('confirmado');
  });
});

describe('perfil do gestor (RN-7, CA-6 na camada de sessão)', () => {
  it('desativar o perfil do gestor não revoga as sessões do gestor', async () => {
    const s = await criarSalaoCompleto();
    const sessao = await entrarDeVerdade(s.gestor.email);
    expect(await desativarProfissional.executar(sessao.credencial, { id: s.gestor.profissionalId })).toEqual({
      ok: true,
      dados: { resultado: 'desativado' },
    });
    expect((await sessoesDe(c, s.gestor.usuarioId)).every((z) => z.revogada_em === null)).toBe(true);
    expect((await resolverTenant(sessao.credencial)).papel).toBe('gestor');
  });

  it('reativar com id de A já ativo é idempotente', async () => {
    const r = await reativarProfissional.executar(await gestorDe(a), { id: a.profissional.profissionalId });
    expect(r).toEqual({ ok: true, dados: { resultado: 'reativado' } });
  });
});
