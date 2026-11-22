import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { editarSalao, estenderTeste, lerSalao, reativarSalao, suspenderSalao } from '@/server/admin/saloes';
import { aplicarEventoAssinatura } from '@/server/assinatura/servico';
import { encerrarPrisma } from '@/server/repos/db';
import { contextoDeSistema } from '@/server/tenant/context';

import { DEPS, DIA_MS, adminDeTeste, assinaturaNoBanco, entradaIgual, salaoComAssinatura, salaoEmTeste, salaoNoBanco, slugsNoBanco, usuarioNoBanco } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { linhasDeAuditoria } from '../../support/auditoria';
import { conectar, emailNovo, slugNovo } from '../../support/sql';

// D-044 CA-11: concorrência. Nada de 5xx (exceção), impasse (40P01) nem 23505 vazando: só resultados de negócio.
let c: pg.Client;
let adm: AdminDeTeste;
const AGORA = new Date('2027-05-10T12:00:00Z');

beforeAll(async () => {
  c = await conectar();
  adm = await adminDeTeste();
});
afterAll(async () => {
  await c.end();
  await encerrarPrisma();
});

const auditoriaDo = (salaoId: string, like: string) => linhasDeAuditoria(c, 'salao_id = $1 AND acao LIKE $2', [salaoId, like]);
const contar = <T extends { resultado: string }>(rs: T[]) => rs.reduce<Record<string, number>>((m, r) => ({ ...m, [r.resultado]: (m[r.resultado] ?? 0) + 1 }), {});

describe('CA-11: edição', () => {
  it('editar × editar no mesmo salão (10 em paralelo): todas serializam, o estado final é de uma delas e a auditoria é consistente', async () => {
    const s = await salaoComAssinatura(null);
    const d = await lerSalao(adm.ctx, s.salaoId);
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => editarSalao(adm.ctx, entradaIgual(d, { nome: `Nome ${i}`, grade: i % 2 === 0 ? '30' : '20' }), AGORA, DEPS)),
    );
    expect(contar(rs)).toEqual({ editado: 10 });
    const final = await salaoNoBanco(c, s.salaoId);
    expect(final.nome).toMatch(/^Nome \d$/);
    expect([20, 30]).toContain(final.grade_min);
    const aud = await auditoriaDo(s.salaoId, 'salao.atualizar');
    expect(aud).toHaveLength(10);
    // A cadeia de auditoria é coerente: o `antes` de cada uma é o `depois` de alguma anterior (ou o original).
    const nomes = new Set([s.nome, ...aud.map((a) => (a.depois as { nome: string }).nome)]);
    for (const a of aud) expect(nomes.has((a.antes as { nome: string }).nome)).toBe(true);
  }, 40_000);

  it('slug disputado entre dois salões: um vence, o outro recebe erro de campo', async () => {
    const a = await salaoComAssinatura(null);
    const b = await salaoComAssinatura(null);
    const slug = slugNovo();
    const [ra, rb] = await Promise.all([
      editarSalao(adm.ctx, entradaIgual(await lerSalao(adm.ctx, a.salaoId), { slug }), AGORA, DEPS),
      editarSalao(adm.ctx, entradaIgual(await lerSalao(adm.ctx, b.salaoId), { slug }), AGORA, DEPS),
    ]);
    expect([ra.resultado, rb.resultado].sort()).toEqual(['conflito_slug', 'editado']);
    const donos = [...(await slugsNoBanco(c, a.salaoId)), ...(await slugsNoBanco(c, b.salaoId))].filter((x) => x.slug === slug);
    expect(donos).toHaveLength(1);
  });

  it('o mesmo slug pedido por 10 salões: exatamente um vence', async () => {
    const salas = await Promise.all(Array.from({ length: 10 }, () => salaoComAssinatura(null)));
    const slug = slugNovo();
    const entradas = await Promise.all(salas.map(async (s) => entradaIgual(await lerSalao(adm.ctx, s.salaoId), { slug })));
    const rs = await Promise.all(entradas.map((e) => editarSalao(adm.ctx, e, AGORA, DEPS)));
    expect(contar(rs)).toEqual({ editado: 1, conflito_slug: 9 });
  }, 40_000);

  it('o mesmo e-mail de gestor pedido por dois salões: um vence, o outro email_em_uso, sem 23505 vazando', async () => {
    for (let rodada = 0; rodada < 3; rodada++) {
      const a = await salaoComAssinatura(null);
      const b = await salaoComAssinatura(null);
      const email = emailNovo();
      const rs = await Promise.all([
        editarSalao(adm.ctx, entradaIgual(await lerSalao(adm.ctx, a.salaoId), { gestorEmail: email }), AGORA, DEPS),
        editarSalao(adm.ctx, entradaIgual(await lerSalao(adm.ctx, b.salaoId), { gestorEmail: email }), AGORA, DEPS),
      ]);
      expect(contar(rs)).toEqual({ editado: 1, email_em_uso: 1 });
      const donos = [(await usuarioNoBanco(c, a.gestor.usuarioId)).email, (await usuarioNoBanco(c, b.gestor.usuarioId)).email].filter((e) => e === email);
      expect(donos).toHaveLength(1);
    }
  }, 40_000);
});

describe('CA-11: suspensão', () => {
  it('suspender × suspender (10 em paralelo): um suspenso, nove sem_efeito, uma auditoria', async () => {
    const s = await salaoComAssinatura('ativa');
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: `Motivo ${i} válido`, etapa: 'confirmar' }, AGORA)));
    expect(contar(rs)).toEqual({ suspenso: 1, sem_efeito: 9 });
    expect(await auditoriaDo(s.salaoId, 'salao.suspender')).toHaveLength(1);
  }, 40_000);

  it('suspender × reativar × editar em paralelo: sem impasse, estado final coerente com a auditoria', async () => {
    for (let rodada = 0; rodada < 3; rodada++) {
      const s = await salaoComAssinatura('ativa');
      const d = await lerSalao(adm.ctx, s.salaoId);
      const rs = await Promise.all([
        suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Motivo válido', etapa: 'confirmar' }, AGORA),
        editarSalao(adm.ctx, entradaIgual(d, { nome: `Editado ${rodada}` }), AGORA, DEPS),
        reativarSalao(adm.ctx, { salaoId: s.salaoId }, AGORA),
        suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Outro motivo válido', etapa: 'confirmar' }, AGORA),
      ]);
      expect(rs.every((r) => ['suspenso', 'reativado', 'sem_efeito', 'editado'].includes(r.resultado))).toBe(true);
      const suspensoes = (await auditoriaDo(s.salaoId, 'salao.suspender')).length;
      const reativacoes = (await auditoriaDo(s.salaoId, 'salao.reativar')).length;
      const suspenso = (await salaoNoBanco(c, s.salaoId)).suspenso_manual_em !== null;
      expect(suspensoes - reativacoes).toBe(suspenso ? 1 : 0);
      expect((await salaoNoBanco(c, s.salaoId)).nome).toBe(`Editado ${rodada}`);
    }
  }, 40_000);
});

describe('CA-11: extensão', () => {
  it('estender × estender com o mesmo D (10 em paralelo): um estendido, os demais mudou; fim = D + N', async () => {
    const s = await salaoEmTeste();
    const D = s.fim!;
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => estenderTeste(adm.ctx, { salaoId: s.salaoId, dias: '10', testeFimEmEsperado: D.toISOString(), etapa: 'confirmar' }, new Date(), DEPS)),
    );
    expect(contar(rs)).toEqual({ estendido: 1, mudou: 9 });
    expect((await assinaturaNoBanco(s.assinaturaId)).testeFimEm).toEqual(new Date(D.getTime() + 10 * DIA_MS));
    expect((await linhasDeAuditoria(c, `salao_id = $1 AND acao = 'salao.estender_teste' AND resultado = 'sucesso'`, [s.salaoId]))).toHaveLength(1);
  }, 40_000);

  it('estender × cobrança aprovada (ativa) em paralelo: sem impasse; o estado final é ativa e o fim é coerente com a auditoria', async () => {
    for (let rodada = 0; rodada < 5; rodada++) {
      const s = await salaoEmTeste();
      const D = s.fim!;
      const [r] = await Promise.all([
        estenderTeste(adm.ctx, { salaoId: s.salaoId, dias: '7', testeFimEmEsperado: D.toISOString(), etapa: 'confirmar' }, new Date(), DEPS),
        aplicarEventoAssinatura(
          contextoDeSistema(s.salaoId, 'teste'),
          { tipo: 'cobranca_aprovada', pagamentoId: `ext-${s.salaoId}`, valorCentavos: 7900, pagoEm: new Date() },
          new Date(),
        ),
      ]);
      expect(['estendido', 'recusado', 'divergencia', 'mudou']).toContain(r.resultado);
      const a = await assinaturaNoBanco(s.assinaturaId);
      expect(a.estado).toBe('ativa');
      const sucessos = await linhasDeAuditoria(c, `salao_id = $1 AND acao = 'salao.estender_teste' AND resultado = 'sucesso'`, [s.salaoId]);
      if (r.resultado === 'estendido') {
        expect(sucessos).toHaveLength(1);
      } else {
        expect(sucessos).toHaveLength(0);
        expect(a.testeFimEm).toEqual(D);
      }
    }
  }, 60_000);

  it('estender × estender em salões diferentes não se bloqueiam', async () => {
    const ss = await Promise.all(Array.from({ length: 6 }, () => salaoEmTeste()));
    const rs = await Promise.all(ss.map((s) => estenderTeste(adm.ctx, { salaoId: s.salaoId, dias: '2', testeFimEmEsperado: s.fim!.toISOString(), etapa: 'confirmar' }, new Date(), DEPS)));
    expect(contar(rs)).toEqual({ estendido: 6 });
  }, 40_000);
});

describe('CA-11: travas (RN-8)', () => {
  it('estender NÃO espera a trava do salão; editar e suspender esperam (FOR NO KEY UPDATE)', async () => {
    const s = await salaoEmTeste();
    const segurando = await conectar();
    try {
      await segurando.query('BEGIN');
      await segurando.query('SELECT 1 FROM salao WHERE id = $1 FOR NO KEY UPDATE', [s.salaoId]);
      const ext = await estenderTeste(adm.ctx, { salaoId: s.salaoId, dias: '1', testeFimEmEsperado: s.fim!.toISOString(), etapa: 'confirmar' }, new Date(), DEPS);
      expect(ext.resultado).toBe('estendido');
      const d = await lerSalao(adm.ctx, s.salaoId);
      let terminou = false;
      const edicao = editarSalao(adm.ctx, entradaIgual(d, { nome: 'Espera a trava' }), AGORA, DEPS).then((r) => ((terminou = true), r));
      const susp = suspenderSalao(adm.ctx, { salaoId: s.salaoId, motivo: 'Espera a trava', etapa: 'confirmar' }, AGORA).then((r) => ((terminou = true), r));
      await new Promise((ok) => setTimeout(ok, 600));
      expect(terminou).toBe(false);
      await segurando.query('COMMIT');
      expect((await edicao).resultado).toBe('editado');
      expect((await susp).resultado).toBe('suspenso');
    } finally {
      await segurando.end();
    }
  }, 30_000);
});
