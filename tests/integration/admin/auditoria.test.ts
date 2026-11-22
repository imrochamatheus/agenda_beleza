import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listarAuditoria } from '@/server/admin/auditoria';
import { reenviarMensagemAdmin } from '@/server/admin/mensagens';
import { registrarAuditoria } from '@/server/auditoria/registrar';
import { emTransacao } from '@/server/repos/transacao';

import { adminDeTeste } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { contarAuditoria } from '../../support/auditoria';
import { criarSalaoCompleto } from '../../support/factories';
import { criarCenarioMensagem, criarMensagem } from '../../support/mensagens';
import { conectar } from '../../support/sql';

// D-045 CA-4, CA-7, CA-12: consulta de auditoria. PostgreSQL real. A virada de dia é em America/Sao_Paulo
// (RN-12); rode em TZ=UTC e TZ=America/Sao_Paulo (o resultado não pode mudar).
let c: pg.Client;
let adm: AdminDeTeste;
let adm2: AdminDeTeste;
let s1: { salaoId: string; nome: string };
let s2: { salaoId: string; nome: string };

async function inserir(o: { ator?: string | null; atorEmail?: string | null; acao: string; entidade?: string | null; salaoId?: string | null; resultado?: 'sucesso' | 'falha'; em: string; antes?: object | null; depois?: object | null }) {
  await c.query(
    `INSERT INTO auditoria (ator_id, ator_email_informado, acao, entidade, entidade_id, salao_id, antes, depois, resultado, ocorrido_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [o.ator ?? null, o.atorEmail ?? null, o.acao, o.entidade ?? null, o.entidade ? 'x' : null, o.salaoId ?? null, o.antes ? JSON.stringify(o.antes) : null, o.depois ? JSON.stringify(o.depois) : null, o.resultado ?? 'sucesso', o.em],
  );
}

beforeAll(async () => {
  c = await conectar();
  adm = await adminDeTeste();
  adm2 = await adminDeTeste();
  const a = await criarSalaoCompleto();
  const b = await criarSalaoCompleto();
  s1 = { salaoId: a.salaoId, nome: (await c.query<{ nome: string }>('SELECT nome FROM salao WHERE id = $1', [a.salaoId])).rows[0].nome };
  s2 = { salaoId: b.salaoId, nome: (await c.query<{ nome: string }>('SELECT nome FROM salao WHERE id = $1', [b.salaoId])).rows[0].nome };
  // 45 registros do admin 1 no salão 1, um por hora a partir de 2026-11-10T10:00Z.
  for (let i = 0; i < 45; i++) {
    await inserir({ ator: adm.usuarioId, acao: 'salao.suspender', entidade: 'salao', salaoId: s1.salaoId, em: new Date(Date.parse('2026-11-10T10:00:00Z') + i * 3_600_000).toISOString(), antes: { suspenso: false }, depois: { suspenso: true, motivo: `m${i}` } });
  }
  await inserir({ ator: adm2.usuarioId, acao: 'salao.reativar', entidade: 'salao', salaoId: s2.salaoId, em: '2026-11-05T12:00:00Z', antes: { suspenso: true }, depois: { suspenso: false } });
  await inserir({ atorEmail: 'quem.tentou@exemplo.com.br', acao: 'login.falha_senha', entidade: 'usuario', em: '2026-11-06T12:00:00Z', resultado: 'falha' });
  await inserir({ acao: 'login.sucesso', entidade: 'usuario', em: '2026-11-07T12:00:00Z' });
}, 60_000);
afterAll(async () => {
  await c?.end();
});

const listar = (sp: Record<string, string | string[] | undefined>) => listarAuditoria(adm.ctx, sp);

describe('CA-4: filtrar por salão mostra só as ações dele, com antes e depois', () => {
  it('suspensão + reenvio do salão 1 e ações do salão 2: o filtro devolve só o salão 1', async () => {
    const m = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: m.salaoId, reservaId: m.reservaId, estado: 'falhou', destinatarioE164: m.telefone });
    await reenviarMensagemAdmin(adm.ctx, id, new Date(), { enfileirar: async () => ({ criado: true as const, id: 'j' }) });
    await emTransacao((r) =>
      registrarAuditoria(adm.ctx, { acao: 'salao.suspender', entidade: 'salao', entidadeId: m.salaoId, salaoId: m.salaoId, antes: { suspenso: false }, depois: { suspenso: true } }, r),
    );
    const r = await listar({ salao: m.salaoId });
    expect(r.total).toBe(2);
    expect(r.itens.map((i) => i.acao).sort()).toEqual(['mensagem.reenviar', 'salao.suspender']);
    expect(r.itens.every((i) => i.salaoId === m.salaoId && i.salaoNome === m.salaoNome)).toBe(true);
    const reenvio = r.itens.find((i) => i.acao === 'mensagem.reenviar')!;
    expect(reenvio.antes).toEqual({ estado: 'falhou' });
    expect(reenvio.depois).toEqual({ estado: 'pendente', tipo: 'confirmacao', revisao: 0 });
    expect(r.itens.find((i) => i.acao === 'salao.suspender')!.depois).toEqual({ suspenso: true });
    const outro = await listar({ salao: s2.salaoId });
    expect(outro.itens.map((i) => i.acao)).toEqual(['salao.reativar']);
  });
});

describe('CA-12: filtros, paginação e ordem', () => {
  it('ator por e-mail do usuário (qualquer caixa), e por e-mail informado', async () => {
    const [u] = (await c.query<{ email: string }>('SELECT email FROM usuario WHERE id = $1', [adm2.usuarioId])).rows;
    const r = await listar({ ator: u.email.toUpperCase() });
    expect(r.itens.map((i) => i.acao)).toEqual(['salao.reativar']);
    expect(r.itens[0].atorEmail).toBe(u.email);
    const f = await listar({ ator: 'quem.tentou@exemplo.com.br' });
    expect(f.itens.map((i) => [i.acao, i.resultado, i.atorEmail])).toEqual([['login.falha_senha', 'falha', 'quem.tentou@exemplo.com.br']]);
    expect((await listar({ ator: 'ninguem@exemplo.com.br' })).total).toBe(0);
  });

  it('ação e resultado; sem ator: atorEmail nulo ("Sistema")', async () => {
    expect((await listar({ acao: 'login.sucesso' })).itens[0].atorEmail).toBeNull();
    expect((await listar({ resultado: 'falha' })).itens.map((i) => i.acao)).toEqual(['login.falha_senha']);
    expect((await listar({ acao: 'salao.suspender', salao: s1.salaoId })).total).toBe(45);
  });

  it('45 registros: 20 por página, ordem decrescente estável, sem repetir', async () => {
    const ps = await Promise.all([1, 2, 3].map((n) => listar({ salao: s1.salaoId, acao: 'salao.suspender', pagina: String(n) })));
    expect(ps.map((p) => p.itens.length)).toEqual([20, 20, 5]);
    expect(ps[0].paginas).toBe(3);
    const todos = ps.flatMap((p) => p.itens);
    expect(new Set(todos.map((i) => i.id)).size).toBe(45);
    const datas = todos.map((i) => i.ocorridoEm);
    expect([...datas].sort().reverse()).toEqual(datas);
    expect((await listar({ salao: s1.salaoId, acao: 'salao.suspender', pagina: '9' })).itens).toEqual([]);
    expect((await listar({ salao: s1.salaoId, acao: 'salao.suspender', pagina: '9' })).total).toBe(45);
  });

  it('período: dia civil em America/Sao_Paulo, de e ate inclusivos; virada de dia às 02:30 UTC', async () => {
    await inserir({ ator: adm.usuarioId, acao: 'salao.atualizar', entidade: 'salao', salaoId: s2.salaoId, em: '2026-12-11T02:30:00Z', antes: { a: 1 }, depois: { a: 2 } });
    await inserir({ ator: adm.usuarioId, acao: 'salao.atualizar', entidade: 'salao', salaoId: s2.salaoId, em: '2026-12-11T03:00:00Z', antes: { a: 2 }, depois: { a: 3 } });
    const dia10 = await listar({ acao: 'salao.atualizar', de: '2026-12-10', ate: '2026-12-10' });
    expect(dia10.itens.map((i) => i.ocorridoEm)).toEqual(['2026-12-11T02:30:00.000Z']);
    const dia11 = await listar({ acao: 'salao.atualizar', de: '11/12/2026', ate: '11/12/2026' });
    expect(dia11.itens.map((i) => i.ocorridoEm)).toEqual(['2026-12-11T03:00:00.000Z']);
    expect((await listar({ acao: 'salao.atualizar', de: '2026-12-10', ate: '2026-12-11' })).total).toBe(2);
    expect((await listar({ acao: 'salao.atualizar', de: '2026-12-11' })).total).toBe(1);
    expect((await listar({ acao: 'salao.atualizar', ate: '2026-12-10' })).total).toBe(1);
  });

  it('período inválido ou invertido: erro de campo, período ignorado, sem 500', async () => {
    const inv = await listar({ acao: 'salao.atualizar', de: '2026-12-11', ate: '2026-12-10' });
    expect(inv.erros.de).toBe('A data inicial é depois da final.');
    expect(inv.total).toBe(2);
    const ruim = await listar({ acao: 'salao.atualizar', de: '31/02/2026' });
    expect(ruim.erros.de).toBe('Data inválida.');
    expect(ruim.total).toBe(2);
  });

  it('filtros inválidos de lista fechada e UUID: ignorados com aviso', async () => {
    const r = await listar({ acao: 'nao.existe', salao: 'x', resultado: 'talvez' });
    expect(r.ignorados).toBe(true);
    expect(r.total).toBeGreaterThan(45);
  });

  it('antes e depois saem como gravados (objeto), inclusive nulos', async () => {
    const r = await listar({ acao: 'login.sucesso' });
    expect(r.itens[0].antes).toBeNull();
    expect(r.itens[0].depois).toBeNull();
    const s = await listar({ acao: 'salao.suspender', salao: s1.salaoId });
    expect(s.itens[0].depois).toMatchObject({ suspenso: true });
  });
});

describe('CA-7: ler a auditoria não grava auditoria', () => {
  it('listar, filtrar e paginar não criam linhas', async () => {
    const n = await contarAuditoria(c);
    await listar({});
    await listar({ acao: 'salao.suspender', pagina: '2' });
    await listar({ de: '2026-11-01', ate: '2026-11-30', ator: 'x@y.com.br' });
    await listar({ salao: 'invalido' });
    expect(await contarAuditoria(c)).toBe(n);
  });
});
