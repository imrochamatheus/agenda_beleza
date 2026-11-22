import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmacaoDeReenvio, detalheDeTentativas, listarMensagens } from '@/server/admin/mensagens';
import { CHAVES_MENSAGEM_ADMIN } from '@/server/admin/mensagens-tipos';
import { NaoEncontrado } from '@/server/tenant/erros';

import { adminDeTeste } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { contarAuditoria } from '../../support/auditoria';
import { anonimizarCliente, criarCenarioMensagem, criarMensagem, lerMensagem } from '../../support/mensagens';
import type { CenarioMensagem, EstadoMsg, TipoMsg } from '../../support/mensagens';
import { conectar } from '../../support/sql';

// D-045 CA-5, CA-7, CA-8, CA-9, CA-10: fila global de mensagens. PostgreSQL real; cada arquivo tem a sua base.
let c: pg.Client;
let adm: AdminDeTeste;
let a: CenarioMensagem;
let b: CenarioMensagem;
const MIN = 60_000;
const T0 = Date.parse('2026-11-01T12:00:00Z');

beforeAll(async () => {
  c = await conectar();
  adm = await adminDeTeste();
  a = await criarCenarioMensagem({ salaoNome: 'Aurora Studio' });
  b = await criarCenarioMensagem({ salaoNome: 'Brisa Salão' });
  // Salão A: 45 mensagens (remarcação revisões 1..45), estados alternados; criadas a cada minuto.
  for (let i = 1; i <= 45; i++) {
    const estado: EstadoMsg = i % 3 === 0 ? 'falhou' : i % 3 === 1 ? 'enviada' : 'pendente';
    await criarMensagem({ salaoId: a.salaoId, reservaId: a.reservaId, tipo: 'remarcacao', revisao: i, estado, destinatarioE164: a.telefone, atualizadoEm: new Date(T0 + i * MIN) });
  }
  // Salão B: 3 mensagens, uma de cada tipo/estado.
  const tipos: [TipoMsg, EstadoMsg][] = [['confirmacao', 'falhou'], ['cancelamento', 'enviada'], ['convite_avaliacao', 'nao_enviada']];
  for (const [i, [tipo, estado]] of tipos.entries()) {
    await criarMensagem({ salaoId: b.salaoId, reservaId: b.reservaId, tipo, revisao: tipo === 'confirmacao' || tipo === 'convite_avaliacao' ? 0 : 1, estado, destinatarioE164: b.telefone, atualizadoEm: new Date(T0 + (100 + i) * MIN) });
  }
}, 120_000);
afterAll(async () => {
  await c?.end();
});

const listar = (sp: Record<string, string | string[] | undefined>) => listarMensagens(adm.ctx, sp);

describe('CA-9: filtros, total, página e ordem', () => {
  it('sem filtro: total, 20 por página e ordem criado_em DESC com id como desempate', async () => {
    const r = await listar({});
    expect(r.total).toBe(48);
    expect(r.paginas).toBe(3);
    expect(r.itens).toHaveLength(20);
    const criadas = r.itens.map((m) => m.criadaEm);
    expect([...criadas].sort().reverse()).toEqual(criadas);
    // As 3 do salão B (mais novas) vêm primeiro.
    expect(r.itens.slice(0, 3).every((m) => m.salaoId === b.salaoId)).toBe(true);
    expect(r.ignorados).toBe(false);
  });

  it('páginas 2 e 3 não repetem nem perdem linhas; a 3ª tem as 8 restantes', async () => {
    const [p1, p2, p3] = await Promise.all([listar({ pagina: '1' }), listar({ pagina: '2' }), listar({ pagina: '3' })]);
    const ids = [...p1.itens, ...p2.itens, ...p3.itens].map((m) => m.id);
    expect(ids).toHaveLength(48);
    expect(new Set(ids).size).toBe(48);
    expect(p3.itens).toHaveLength(8);
  });

  it('estado × salão × tipo: a interseção, com total correto', async () => {
    expect((await listar({ salao: a.salaoId, estado: 'falhou' })).total).toBe(15);
    expect((await listar({ salao: a.salaoId, estado: 'falhou', tipo: 'remarcacao' })).total).toBe(15);
    expect((await listar({ salao: a.salaoId, estado: 'falhou', tipo: 'cancelamento' })).total).toBe(0);
    const f = await listar({ estado: 'falhou' });
    expect(f.total).toBe(16);
    expect(f.itens.every((m) => m.estado === 'falhou')).toBe(true);
    const t = await listar({ tipo: 'convite_avaliacao' });
    expect(t.itens.map((m) => [m.salaoId, m.estado])).toEqual([[b.salaoId, 'nao_enviada']]);
  });

  it('além do fim: vazio, mas o total continua; página acima de 500 vale 500', async () => {
    const r = await listar({ pagina: '4' });
    expect(r.itens).toEqual([]);
    expect(r.total).toBe(48);
    expect(r.pagina).toBe(4);
    const alta = await listar({ pagina: '99999' });
    expect(alta.pagina).toBe(500);
    expect(alta.itens).toEqual([]);
  });

  it('valores inválidos viram filtro ignorado com aviso, nunca erro', async () => {
    for (const sp of [{ estado: 'xyz' }, { tipo: "'; DROP TABLE mensagem; --" }, { salao: 'nao-uuid' }, { pagina: 'abc' }, { estado: ['falhou', 'enviada'] }]) {
      const r = await listar(sp);
      expect(r.total).toBe(48);
      expect(r.ignorados).toBe(sp.pagina === 'abc' ? false : true);
    }
    expect(await contarMensagens()).toBe(48);
  });

  it('salão inexistente (UUID válido): vazio', async () => {
    const r = await listar({ salao: '00000000-0000-4000-8000-000000000000' });
    expect(r.total).toBe(0);
    expect(r.itens).toEqual([]);
  });
});

async function contarMensagens(): Promise<number> {
  const { rows } = await c.query<{ n: string }>('SELECT count(*) AS n FROM mensagem WHERE salao_id = ANY($1)', [[a.salaoId, b.salaoId]]);
  return Number(rows[0].n);
}

describe('filtro de salão: select × código (limite injetável)', () => {
  it('abaixo do limite: select com os salões por nome; acima: modo código', async () => {
    const todos = await listarMensagens(adm.ctx, {});
    expect(todos.salao.modo).toBe('select');
    const nomes = todos.salao.modo === 'select' ? todos.salao.opcoes.map((o) => o.nome) : [];
    expect(nomes).toEqual(expect.arrayContaining(['Aurora Studio', 'Brisa Salão']));
    expect([...nomes].sort()).toEqual(nomes.length ? [...nomes].sort() : []);
    const total = nomes.length;
    expect((await listarMensagens(adm.ctx, {}, { limiteSelectSaloes: total })).salao.modo).toBe('select');
    expect((await listarMensagens(adm.ctx, {}, { limiteSelectSaloes: total - 1 })).salao).toEqual({ modo: 'codigo' });
  });
});

describe('CA-5 e CA-8: máscara e projeção mínima', () => {
  it('telefone mascarado; o DTO só tem as chaves declaradas; nada de E.164 no JSON', async () => {
    const r = await listar({ salao: a.salaoId });
    const ddd = a.telefone.slice(3, 5);
    const ultimos = a.telefone.slice(-4);
    for (const m of r.itens) {
      expect(Object.keys(m).sort()).toEqual([...CHAVES_MENSAGEM_ADMIN].sort());
      expect(m.paraMascarado).toMatch(new RegExp(`^\\+55 \\(${ddd}\\) (9)?\\*{4}-${ultimos}$`));
    }
    const json = JSON.stringify(r);
    expect(json).not.toContain(a.telefone);
    expect(json).not.toContain(a.telefone.slice(3));
    expect(json).not.toContain(a.clienteNome);
  });

  it('a lista não carrega parâmetros, id do provedor, erro_detalhe nem chave, mesmo gravados', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', erroCodigo: 'resultado_incerto', destinatarioE164: s.telefone, provedorMensagemId: 'wamid.SEGREDO123', tentativas: [{ resultado: 'falha', erroCodigo: 'resultado_incerto' }] });
    await c.query(`UPDATE mensagem SET parametros = '{"link":"https://x.test/avaliar/TOKENSECRETO"}'::jsonb WHERE id = $1`, [id]);
    await c.query(`UPDATE mensagem_tentativa SET erro_detalhe = 'falha ao enviar para ${s.telefone}' WHERE mensagem_id = $1`, [id]);
    const lista = JSON.stringify(await listar({ salao: s.salaoId }));
    const det = JSON.stringify(await detalheDeTentativas(adm.ctx, id));
    for (const texto of [lista, det]) {
      for (const proibido of ['SEGREDO123', 'TOKENSECRETO', 'wamid', s.telefone, 'falha ao enviar', s.clienteNome, `${s.reservaId}:`]) expect(texto).not.toContain(proibido);
    }
  });

  it('cliente anonimizada: "Cliente removida", sem nenhum dígito; destinatário nulo: "—"', async () => {
    const s = await criarCenarioMensagem();
    await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', destinatarioE164: s.telefone });
    await anonimizarCliente(s.clienteId);
    const r = await listar({ salao: s.salaoId });
    expect(r.itens[0].paraMascarado).toBe('Cliente removida');
    expect(r.itens[0].paraMascarado).not.toMatch(/\d/);
    const s2 = await criarCenarioMensagem();
    await criarMensagem({ salaoId: s2.salaoId, reservaId: s2.reservaId, estado: 'pendente', destinatarioE164: null });
    expect((await listar({ salao: s2.salaoId })).itens[0].paraMascarado).toBe('—');
  });

  it('erro_codigo fora do formato fechado não aparece', async () => {
    const s = await criarCenarioMensagem();
    await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', erroCodigo: `Falha: ${s.telefone}` });
    expect((await listar({ salao: s.salaoId })).itens[0].erroCodigo).toBeNull();
  });
});

describe('CA-10: tentativas', () => {
  it('em ordem de número, com resultado e código; sem erro_detalhe', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({
      salaoId: s.salaoId,
      reservaId: s.reservaId,
      estado: 'enviada',
      destinatarioE164: s.telefone,
      tentativas: [{ resultado: 'falha', erroCodigo: 'resultado_incerto' }, { resultado: 'falha', erroCodigo: 'timeout' }, { resultado: 'sucesso' }, { resultado: null }],
    });
    const d = await detalheDeTentativas(adm.ctx, id);
    expect(d.tentativas.map((t) => [t.numero, t.resultado, t.erroCodigo])).toEqual([
      [1, 'falha', 'resultado_incerto'],
      [2, 'falha', 'timeout'],
      [3, 'sucesso', null],
      [4, null, null],
    ]);
    expect(d.mensagem.id).toBe(id);
    expect(d.mensagem.salaoNome).toBe(s.salaoNome);
  });

  it('mensagem sem tentativas: lista vazia', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'nao_enviada' });
    expect((await detalheDeTentativas(adm.ctx, id)).tentativas).toEqual([]);
  });

  it('malformado e inexistente → NaoEncontrado', async () => {
    for (const id of ['x', '', undefined, '00000000-0000-4000-8000-000000000000']) {
      await expect(detalheDeTentativas(adm.ctx, id)).rejects.toBeInstanceOf(NaoEncontrado);
    }
  });
});

describe('confirmação do reenvio', () => {
  it('só devolve a mensagem quando está falhou; senão, null (sem 404)', async () => {
    const s = await criarCenarioMensagem();
    const f = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', destinatarioE164: s.telefone });
    const e = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'cancelamento', revisao: 1, estado: 'enviada' });
    expect((await confirmacaoDeReenvio(adm.ctx, f))?.id).toBe(f);
    expect(await confirmacaoDeReenvio(adm.ctx, e)).toBeNull();
    expect(await confirmacaoDeReenvio(adm.ctx, 'lixo')).toBeNull();
    expect(await confirmacaoDeReenvio(adm.ctx, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('CA-7: leitura não audita nem altera', () => {
  it('listar, filtrar, paginar, detalhe e confirmação: zero linhas novas em auditoria; mensagem igual', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', destinatarioE164: s.telefone });
    const antes = await lerMensagem(id);
    const n = await contarAuditoria(c);
    await listar({});
    await listar({ estado: 'falhou', pagina: '2' });
    await listar({ salao: 'invalido' });
    await detalheDeTentativas(adm.ctx, id);
    await confirmacaoDeReenvio(adm.ctx, id);
    expect(await contarAuditoria(c)).toBe(n);
    expect(await lerMensagem(id)).toEqual(antes);
  });
});

describe('ordem estável (por último: cria mensagens novas)', () => {
  it('empate de criado_em: a ordem é estável (id DESC)', async () => {
    const s = await criarCenarioMensagem();
    const mesmo = new Date(T0 - 500 * MIN);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: i + 1, estado: 'enviada', atualizadoEm: mesmo }));
    const r = await listar({ salao: s.salaoId });
    expect(r.itens.map((m) => m.id)).toEqual([...ids].sort().reverse());
  });
});
