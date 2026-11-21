import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { repos, criarRepos } from '@/server/repos';
import { listarServicosPublicos } from '@/server/repos/publico';
import { criarAdminContext, contextoDeSistema } from '@/server/tenant/context';
import type { ContextoDeLeituraDeAgenda } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { conectar } from '../../support/sql';

import {
  MANAUS, UUID_INEXISTENTE, criarCenario, criarClienteComLog, ctxDoGestor, ctxPublico, definirFuncionamento,
  definirRegras, inserirBloqueio, inserirCliente, inserirJornada, inserirProfissional, inserirReserva,
  marcarFuncionamentoNaoInformado, sp, DIA, vincular,
} from './apoio';
import type { Cenario } from './apoio';

// D-018 T-3: repositório de leituras de agenda contra PostgreSQL real, com dois salões. Cada método
// emite uma instrução SQL (ou nenhuma, nos curtos-circuitos), aceita público, tenant e sistema, recusa o
// admin, filtra por salão e só devolve a projeção mínima.

let c: pg.Client;
let s1: Cenario;
let s2: Cenario;
const PERIODO = { de: sp(DIA, '00:00'), ate: sp({ ano: 2026, mes: 12, dia: 2 }, '00:00') };

beforeAll(async () => {
  c = await conectar();
  s1 = await criarCenario(c);
  s2 = await criarCenario(c);
});
afterAll(async () => {
  await c.end();
});

const chaves = (o: object) => Object.keys(o).sort();

describe('guarda de contexto', () => {
  it('aceita público, tenant e sistema do mesmo salão', async () => {
    const ctxs: ContextoDeLeituraDeAgenda[] = [ctxPublico(s1.s), ctxDoGestor(s1.s), contextoDeSistema(s1.s.salaoId, 'teste')];
    for (const ctx of ctxs) {
      const { regras } = await repos().disponibilidade.lerRegras(ctx);
      expect(regras.fuso).toBe('America/Sao_Paulo');
    }
  });

  it('recusa o AdminContext em todos os métodos (erro de programação, não de domínio)', async () => {
    const admin = criarAdminContext(s1.s.gestor.usuarioId) as unknown as ContextoDeLeituraDeAgenda;
    const d = repos().disponibilidade;
    const msg = /leitura de agenda exige/;
    await expect(d.lerRegras(admin)).rejects.toThrow(msg);
    await expect(d.servicosOfertaveis(admin, [s1.A])).rejects.toThrow(msg);
    await expect(d.candidatos(admin, [s1.A], null)).rejects.toThrow(msg);
    await expect(d.jornadas(admin, [s1.ana])).rejects.toThrow(msg);
    await expect(d.bloqueios(admin, [s1.ana], PERIODO)).rejects.toThrow(msg);
    await expect(d.ocupacoes(admin, [s1.ana], PERIODO)).rejects.toThrow(msg);
  });
});

describe('lerRegras (A-9)', () => {
  it('devolve regras e funcionamento numa única instrução; padrão = não informado', async () => {
    const { cliente, consultas, encerrar } = criarClienteComLog();
    try {
      const r = await criarRepos(cliente).disponibilidade.lerRegras(ctxPublico(s1.s));
      expect(consultas).toHaveLength(1);
      expect(r).toEqual({
        regras: { fuso: 'America/Sao_Paulo', gradeMin: 15, antecedenciaMin: 120, janelaDias: 60, intervaloMin: 0 },
        funcionamento: { definido: false, linhas: [] },
      });
    } finally {
      await encerrar();
    }
  });

  it('lê as regras vigentes e o funcionamento informado (dia sem linhas = fechado)', async () => {
    const x = await criarCenario(c);
    await definirRegras(c, x.s.salaoId, { fuso: MANAUS, grade_min: 30, antecedencia_min: 0, janela_dias: 10, intervalo_min: 15 });
    await definirFuncionamento(c, x.s.salaoId, { 1: [['09:00', '12:00'], ['13:00', '18:00']], 6: [['08:00', '12:00']] });
    const r = await repos().disponibilidade.lerRegras(ctxPublico(x.s));
    expect(r.regras).toEqual({ fuso: MANAUS, gradeMin: 30, antecedenciaMin: 0, janelaDias: 10, intervaloMin: 15 });
    expect(r.funcionamento).toEqual({
      definido: true,
      linhas: [
        { diaSemana: 1, inicioMin: 540, fimMin: 720 },
        { diaSemana: 1, inicioMin: 780, fimMin: 1080 },
        { diaSemana: 6, inicioMin: 480, fimMin: 720 },
      ],
    });
  });

  it('informado com os sete dias fechados é diferente de não informado', async () => {
    const x = await criarCenario(c);
    await definirFuncionamento(c, x.s.salaoId, {});
    expect((await repos().disponibilidade.lerRegras(ctxPublico(x.s))).funcionamento).toEqual({ definido: true, linhas: [] });
  });

  it('CA-31: não informado com linhas residuais → linhas []', async () => {
    const x = await criarCenario(c);
    await definirFuncionamento(c, x.s.salaoId, { 2: [['09:00', '12:00']] });
    await marcarFuncionamentoNaoInformado(c, x.s.salaoId);
    expect((await repos().disponibilidade.lerRegras(ctxPublico(x.s))).funcionamento).toEqual({ definido: false, linhas: [] });
  });

  it('CA-40: o funcionamento de outro salão não vaza; salão inexistente → NaoEncontrado', async () => {
    const x = await criarCenario(c);
    const y = await criarCenario(c);
    await definirFuncionamento(c, y.s.salaoId, { 3: [['10:00', '11:00']] });
    expect((await repos().disponibilidade.lerRegras(ctxPublico(x.s))).funcionamento.definido).toBe(false);
    expect((await repos().disponibilidade.lerRegras(ctxPublico(y.s))).funcionamento.linhas).toHaveLength(1);
    await expect(repos().disponibilidade.lerRegras(contextoDeSistema(UUID_INEXISTENTE, 'teste'))).rejects.toBeInstanceOf(NaoEncontrado);
  });
});

describe('servicosOfertaveis (A-3, R-4)', () => {
  it('equivale a listarServicosPublicos para cada serviço do salão', async () => {
    const x = await criarCenario(c);
    const [semProf] = (await c.query<{ id: string }>(
      `INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min, ativo) VALUES ($1, 'Sem profissional', 1000, 30, true) RETURNING id::text AS id`,
      [x.s.salaoId],
    )).rows;
    const publicos = (await listarServicosPublicos(ctxPublico(x.s))).map((p) => p.id);
    const todos = [x.A, x.B, x.s.servicos.inativoId, semProf.id];
    for (const id of todos) {
      const ofertaveis = (await repos().disponibilidade.servicosOfertaveis(ctxPublico(x.s), [id])).map((o) => o.id);
      expect(ofertaveis.includes(id)).toBe(publicos.includes(id));
    }
    expect(publicos).toContain(x.A);
    expect(publicos).not.toContain(x.s.servicos.inativoId);
    expect(publicos).not.toContain(semProf.id);
  });

  it('devolve só os ofertáveis pedidos, na ordem do nome, com projeção mínima, em 1 SQL', async () => {
    const { cliente, consultas, encerrar } = criarClienteComLog();
    try {
      const r = await criarRepos(cliente).disponibilidade.servicosOfertaveis(ctxPublico(s1.s), [s1.B, s1.A, s1.s.servicos.inativoId]);
      expect(consultas).toHaveLength(1);
      expect(r).toEqual([
        { id: s1.A, nome: 'A', precoCentavos: 5000, duracaoMin: 30 },
        { id: s1.B, nome: 'B', precoCentavos: 8000, duracaoMin: 45 },
      ]);
      expect(chaves(r[0])).toEqual(['duracaoMin', 'id', 'nome', 'precoCentavos']);
    } finally {
      await encerrar();
    }
  });

  it('serviço de outro salão ou id malformado não volta; lista sem UUID válido → [] sem SQL', async () => {
    const { cliente, consultas, encerrar } = criarClienteComLog();
    try {
      const d = criarRepos(cliente).disponibilidade;
      expect(await d.servicosOfertaveis(ctxPublico(s1.s), [s2.A])).toEqual([]);
      expect(consultas).toHaveLength(1);
      expect(await d.servicosOfertaveis(ctxPublico(s1.s), ['x', '', '1; DROP'])).toEqual([]);
      expect(await d.servicosOfertaveis(ctxPublico(s1.s), [])).toEqual([]);
      expect(consultas).toHaveLength(1);
    } finally {
      await encerrar();
    }
  });
});

describe('candidatos', () => {
  it('sem profissional: só ativos, ordem nome/id, com a contagem de vínculos; 1 SQL', async () => {
    const { cliente, consultas, encerrar } = criarClienteComLog();
    try {
      const r = await criarRepos(cliente).disponibilidade.candidatos(ctxPublico(s1.s), [s1.A, s1.B], null);
      expect(consultas).toHaveLength(1);
      expect(r).toEqual([
        { id: s1.ana, nome: 'Ana', ativo: true, vinculos: 2 },
        { id: s1.bia, nome: 'Bia', ativo: true, vinculos: 1 },
      ]);
      expect(chaves(r[0])).toEqual(['ativo', 'id', 'nome', 'vinculos']);
    } finally {
      await encerrar();
    }
  });

  it('com profissional: só ele, inclusive inativo; de outro salão → []; malformado → NaoEncontrado sem SQL', async () => {
    const { cliente, consultas, encerrar } = criarClienteComLog();
    try {
      const d = criarRepos(cliente).disponibilidade;
      expect(await d.candidatos(ctxPublico(s1.s), [s1.A], s1.bia)).toEqual([{ id: s1.bia, nome: 'Bia', ativo: true, vinculos: 1 }]);
      expect(await d.candidatos(ctxPublico(s1.s), [s1.A], s1.s.profissionalInativoId)).toEqual([
        { id: s1.s.profissionalInativoId, nome: expect.any(String), ativo: false, vinculos: 0 },
      ]);
      expect(await d.candidatos(ctxPublico(s1.s), [s1.A], s2.ana)).toEqual([]);
      const antes = consultas.length;
      await expect(d.candidatos(ctxPublico(s1.s), [s1.A], 'nao-e-uuid')).rejects.toBeInstanceOf(NaoEncontrado);
      expect(consultas).toHaveLength(antes);
    } finally {
      await encerrar();
    }
  });

  it('ignora ids de serviço de outro salão na contagem de vínculos', async () => {
    const r = await repos().disponibilidade.candidatos(ctxPublico(s1.s), [s2.A, s2.B], null);
    expect(r.map((x) => x.vinculos)).toEqual([0, 0]);
  });

  it('profissional inativo não aparece na lista geral', async () => {
    const x = await criarCenario(c);
    const inativa = await inserirProfissional(c, x.s.salaoId, 'Zélia', false);
    await vincular(c, x.s.salaoId, x.A, inativa);
    const r = await repos().disponibilidade.candidatos(ctxPublico(x.s), [x.A], null);
    expect(r.map((p) => p.id)).toEqual([x.ana, x.bia]);
  });
});

describe('jornadas', () => {
  it('em lote, ordem profissional/dia/início, só do salão; 1 SQL; lista vazia → [] sem SQL', async () => {
    const x = await criarCenario(c);
    const outro = await criarCenario(c);
    await inserirJornada(c, x.s.salaoId, x.ana, [2], ['13:00', '18:00'], ['09:00', '12:00']);
    await inserirJornada(c, x.s.salaoId, x.bia, [1], ['10:00', '11:00']);
    await inserirJornada(c, outro.s.salaoId, outro.ana, [2], ['08:00', '09:00']);
    const { cliente, consultas, encerrar } = criarClienteComLog();
    try {
      const d = criarRepos(cliente).disponibilidade;
      const r = await d.jornadas(ctxPublico(x.s), [x.ana, x.bia, outro.ana]);
      expect(consultas).toHaveLength(1);
      expect(r).toEqual(
        [
          { profissionalId: x.ana, diaSemana: 2, inicioMin: 540, fimMin: 720 },
          { profissionalId: x.ana, diaSemana: 2, inicioMin: 780, fimMin: 1080 },
          { profissionalId: x.bia, diaSemana: 1, inicioMin: 600, fimMin: 660 },
        ].sort((a, b) => (a.profissionalId < b.profissionalId ? -1 : a.profissionalId > b.profissionalId ? 1 : 0) || a.diaSemana - b.diaSemana || a.inicioMin - b.inicioMin),
      );
      expect(chaves(r[0])).toEqual(['diaSemana', 'fimMin', 'inicioMin', 'profissionalId']);
      expect(await d.jornadas(ctxPublico(x.s), [])).toEqual([]);
      expect(consultas).toHaveLength(1);
    } finally {
      await encerrar();
    }
  });
});

describe('bloqueios', () => {
  it('do salão e dos profissionais informados que intersectam o período; sem motivo; 1 SQL', async () => {
    const x = await criarCenario(c);
    const outro = await criarCenario(c);
    await inserirBloqueio(c, x.s.salaoId, null, sp(DIA, '08:00'), sp(DIA, '09:00'), 'segredo do salão');
    await inserirBloqueio(c, x.s.salaoId, x.ana, sp(DIA, '10:00'), sp(DIA, '11:00'), 'segredo da Ana');
    await inserirBloqueio(c, x.s.salaoId, x.bia, sp(DIA, '10:00'), sp(DIA, '11:00'));
    await inserirBloqueio(c, x.s.salaoId, x.ana, sp({ ano: 2026, mes: 12, dia: 3 }, '10:00'), sp({ ano: 2026, mes: 12, dia: 3 }, '11:00'));
    await inserirBloqueio(c, x.s.salaoId, x.ana, sp({ ano: 2026, mes: 11, dia: 30 }, '22:00'), sp(DIA, '00:30'));
    await inserirBloqueio(c, x.s.salaoId, x.ana, sp({ ano: 2026, mes: 11, dia: 30 }, '10:00'), sp(DIA, '00:00')); // encosta no início
    await inserirBloqueio(c, outro.s.salaoId, null, sp(DIA, '08:00'), sp(DIA, '20:00'));
    const { cliente, consultas, encerrar } = criarClienteComLog();
    try {
      const r = await criarRepos(cliente).disponibilidade.bloqueios(ctxPublico(x.s), [x.ana], PERIODO);
      expect(consultas).toHaveLength(1);
      expect(r).toEqual([
        { profissionalId: x.ana, inicio: sp({ ano: 2026, mes: 11, dia: 30 }, '22:00'), fim: sp(DIA, '00:30') },
        { profissionalId: null, inicio: sp(DIA, '08:00'), fim: sp(DIA, '09:00') },
        { profissionalId: x.ana, inicio: sp(DIA, '10:00'), fim: sp(DIA, '11:00') },
      ]);
      expect(chaves(r[0])).toEqual(['fim', 'inicio', 'profissionalId']);
      expect(JSON.stringify(r)).not.toContain('segredo');
    } finally {
      await encerrar();
    }
  });

  it('só os do salão quando a lista de profissionais é vazia', async () => {
    const x = await criarCenario(c);
    await inserirBloqueio(c, x.s.salaoId, null, sp(DIA, '08:00'), sp(DIA, '09:00'));
    await inserirBloqueio(c, x.s.salaoId, x.ana, sp(DIA, '10:00'), sp(DIA, '11:00'));
    const r = await repos().disponibilidade.bloqueios(ctxPublico(x.s), [], PERIODO);
    expect(r.map((b) => b.profissionalId)).toEqual([null]);
  });
});

describe('ocupacoes (A-5)', () => {
  it('só status ativos, [inicio, ocupado_ate) que intersecta o período, sem id/cliente/status; 1 SQL', async () => {
    const x = await criarCenario(c);
    const outro = await criarCenario(c);
    const cli = await inserirCliente(c, x.s.salaoId);
    const anon = await inserirCliente(c, x.s.salaoId, true);
    const cliOutro = await inserirCliente(c, outro.s.salaoId);
    const base = { salaoId: x.s.salaoId, clienteId: cli };
    const R = (h1: string, h2: string, extra: Partial<Parameters<typeof inserirReserva>[1]> = {}) =>
      inserirReserva(c, { ...base, profissionalId: x.ana, inicio: sp(DIA, h1), fim: sp(DIA, h2), ...extra });
    await R('09:00', '10:00', { status: 'cancelado' });
    await R('10:00', '11:00', { status: 'concluido' });
    await R('11:00', '12:00', { status: 'nao_compareceu' });
    await R('12:00', '13:00', { encaixe: true });
    await R('13:00', '14:00', { clienteId: anon, ocupadoAte: sp(DIA, '14:15') });
    await inserirReserva(c, { ...base, profissionalId: x.bia, inicio: sp(DIA, '09:00'), fim: sp(DIA, '10:00') });
    await inserirReserva(c, { salaoId: outro.s.salaoId, clienteId: cliOutro, profissionalId: outro.ana, inicio: sp(DIA, '15:00'), fim: sp(DIA, '16:00') });
    // Começa antes do período e termina dentro; e a da Bia que só encosta no início.
    await inserirReserva(c, { ...base, profissionalId: x.ana, inicio: sp({ ano: 2026, mes: 11, dia: 30 }, '23:00'), fim: sp(DIA, '00:30') });
    await inserirReserva(c, { ...base, profissionalId: x.bia, inicio: sp({ ano: 2026, mes: 11, dia: 30 }, '22:00'), fim: sp(DIA, '00:00') });
    const { cliente, consultas, encerrar } = criarClienteComLog();
    try {
      const d = criarRepos(cliente).disponibilidade;
      const r = await d.ocupacoes(ctxPublico(x.s), [x.ana], PERIODO);
      expect(consultas).toHaveLength(1);
      expect(r).toEqual([
        { profissionalId: x.ana, inicio: sp({ ano: 2026, mes: 11, dia: 30 }, '23:00'), ocupadoAte: sp(DIA, '00:30') },
        { profissionalId: x.ana, inicio: sp(DIA, '10:00'), ocupadoAte: sp(DIA, '11:00') },
        { profissionalId: x.ana, inicio: sp(DIA, '11:00'), ocupadoAte: sp(DIA, '12:00') },
        { profissionalId: x.ana, inicio: sp(DIA, '12:00'), ocupadoAte: sp(DIA, '13:00') },
        { profissionalId: x.ana, inicio: sp(DIA, '13:00'), ocupadoAte: sp(DIA, '14:15') },
      ]);
      expect(chaves(r[0])).toEqual(['inicio', 'ocupadoAte', 'profissionalId']);
      const lote = await d.ocupacoes(ctxPublico(x.s), [x.ana, x.bia], PERIODO);
      expect(new Set(lote.map((o) => o.profissionalId))).toEqual(new Set([x.ana, x.bia]));
      // A reserva da Bia que só encosta no início do período (fim = de) não entra.
      expect(lote.filter((o) => o.profissionalId === x.bia)).toEqual([{ profissionalId: x.bia, inicio: sp(DIA, '09:00'), ocupadoAte: sp(DIA, '10:00') }]);
      expect(await d.ocupacoes(ctxPublico(x.s), [], PERIODO)).toEqual([]);
      expect(consultas).toHaveLength(2);
    } finally {
      await encerrar();
    }
  });

  it('o filtro por salão vale mesmo com o profissional de outro salão na lista', async () => {
    const x = await criarCenario(c);
    const outro = await criarCenario(c);
    const cliOutro = await inserirCliente(c, outro.s.salaoId);
    await inserirReserva(c, { salaoId: outro.s.salaoId, clienteId: cliOutro, profissionalId: outro.ana, inicio: sp(DIA, '15:00'), fim: sp(DIA, '16:00') });
    expect(await repos().disponibilidade.ocupacoes(ctxPublico(x.s), [outro.ana], PERIODO)).toEqual([]);
    expect(await repos().disponibilidade.ocupacoes(ctxPublico(outro.s), [outro.ana], PERIODO)).toHaveLength(1);
  });

  it('ids malformados na lista são descartados', async () => {
    expect(await repos().disponibilidade.ocupacoes(ctxPublico(s1.s), ['x', "'; DROP TABLE reserva; --"], PERIODO)).toEqual([]);
  });
});
