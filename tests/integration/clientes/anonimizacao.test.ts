import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { anonimizarCliente } from '@/server/clientes/anonimizar';
import type { DepsAnonimizar } from '@/server/clientes/anonimizar';
import * as acoes from '@/server/clientes/clientes.acao';
import { listar, obter, upsertCliente } from '@/server/clientes/servico';
import { MENSAGENS_CLIENTE } from '@/server/clientes/tipos';
import { reenviarMensagem } from '@/server/mensagens/reenviar';
import { repoMensagemSistema } from '@/server/repos/mensagem-sistema';
import { emTransacao } from '@/server/repos/transacao';
import { metadadosDaAcao } from '@/server/tenant/define-acao';
import { NaoEncontrado } from '@/server/tenant/erros';

import { criarDoisSaloes, instanteFuturo } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { criarMensagem } from '../../support/mensagens';
import { conectar } from '../../support/sql';

import {
  ACESSO_NEGADO,
  NAO_AUTENTICADO,
  NAO_ENCONTRADO,
  UUID_INEXISTENTE,
  credGestor,
  credProfissional,
  ctxDoGestor,
  fotografiaReservas,
  inserirReservaComPreco,
  linhaCliente,
} from './apoio';

// D-031 T-2: anonimização da cliente contra PostgreSQL real. CA-1, 2, 4, 5, 6, 7, 8, 9, 10 (sequencial),
// 12, 14 e 15; RN-1..RN-10.

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(async () => {
  await c.end();
});

let sequencia = 0;
let dia = 10;
/** Dia (a partir de hoje) ainda não usado: cada reserva do profissional fica em um dia próprio. */
const proximoDia = () => (dia += 1);
const AGORA = new Date('2026-11-22T12:00:00Z');

/** Telefone único deste arquivo. */
const telefone = () => `+55119${String(50_000_000 + ++sequencia).padStart(8, '0')}`;

/** Cliente nova no salão, com uma reserva (a do salão de fábrica pertence a outra cliente). */
async function clienteComReserva(s: SalaoCompleto, tel = telefone()): Promise<{ id: string; tel: string; reservaId: string }> {
  const { rows } = await c.query<{ id: string }>(
    "INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, 'Fulana de Tal', $2) RETURNING id::text AS id",
    [s.salaoId, tel],
  );
  const id = rows[0].id;
  const reservaId = await inserirReservaComPreco(c, {
    salaoId: s.salaoId,
    profissionalId: s.gestor.profissionalId as string,
    clienteId: id,
    inicio: instanteFuturo(proximoDia(), 13),
    status: 'confirmado',
    itens: [{ servicoId: s.servicos.ativos[0], precoCentavos: 9000, duracaoMin: 60 }],
  });
  return { id, tel, reservaId };
}

/** Ocorrências do telefone (com e sem +55) em todos os lugares onde ele pode estar (CA-5). */
async function ocorrencias(salaoId: string, tel: string): Promise<number> {
  const semMais = tel.slice(1);
  const nacional = tel.slice(3);
  let total = 0;
  for (const alvo of [tel, semMais, nacional]) {
    const like = `%${alvo}%`;
    for (const sql of [
      'SELECT count(*) AS n FROM cliente WHERE salao_id = $1 AND (telefone_e164 LIKE $2 OR nome LIKE $2)',
      'SELECT count(*) AS n FROM mensagem WHERE salao_id = $1 AND (destinatario_e164 LIKE $2 OR parametros::text LIKE $2)',
      `SELECT count(*) AS n FROM mensagem_tentativa t JOIN mensagem m ON m.id = t.mensagem_id
        WHERE m.salao_id = $1 AND t.erro_detalhe LIKE $2`,
    ]) {
      total += Number((await c.query<{ n: string }>(sql, [salaoId, like])).rows[0].n);
    }
  }
  return total;
}

async function tentativa(mensagemId: string, numero: number, erroDetalhe: string | null, resultado: 'falha' | 'sucesso' | null = 'falha') {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO mensagem_tentativa (mensagem_id, numero, resultado, erro_codigo, erro_detalhe, finalizada_em)
     VALUES ($1, $2, $3::resultado_tentativa, $4, $5, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END) RETURNING id::text AS id`,
    [mensagemId, numero, resultado, resultado === 'falha' ? 'erro_x' : null, erroDetalhe],
  );
  return rows[0].id;
}

const anonimizar = (s: SalaoCompleto, clienteId: string, deps: DepsAnonimizar = {}) => anonimizarCliente(ctxDoGestor(s), { clienteId }, AGORA, deps);

describe('CA-1 e CA-2: anonimiza e some da busca', () => {
  it('3 reservas permanecem; nome e telefone NULL; anonimizada_em do relógio injetado; busca por nome e telefone vazia', async () => {
    const k = await clienteComReserva(a);
    for (const dias of [30, 40]) {
      await inserirReservaComPreco(c, {
        salaoId: a.salaoId,
        profissionalId: a.gestor.profissionalId as string,
        clienteId: k.id,
        inicio: instanteFuturo(proximoDia() + dias, 13),
        status: 'concluido',
        itens: [{ servicoId: a.servicos.ativos[1], precoCentavos: 5500, duracaoMin: 30 }],
      });
    }
    const antes = await fotografiaReservas(c, a.salaoId);
    expect(await listar(ctxDoGestor(a), { q: 'fulana' })).toMatchObject({ total: 1 });
    expect(await listar(ctxDoGestor(a), { q: k.tel.slice(3) })).toMatchObject({ total: 1 });

    const r = await anonimizar(a, k.id);
    expect(r).toEqual({ resultado: 'anonimizada', canceladas: 0 });
    const linha = await c.query<{ nome: string | null; telefone_e164: string | null; anonimizada_em: Date; atualizado_em: Date }>(
      'SELECT nome, telefone_e164, anonimizada_em, atualizado_em FROM cliente WHERE id = $1',
      [k.id],
    );
    expect(linha.rows[0].nome).toBeNull();
    expect(linha.rows[0].telefone_e164).toBeNull();
    expect(linha.rows[0].anonimizada_em.toISOString()).toBe(AGORA.toISOString());
    expect(linha.rows[0].atualizado_em.toISOString()).toBe(AGORA.toISOString());
    expect(await fotografiaReservas(c, a.salaoId)).toEqual(antes);
    const { rows } = await c.query<{ n: string }>('SELECT count(*) AS n FROM reserva WHERE cliente_id = $1', [k.id]);
    expect(Number(rows[0].n)).toBe(3);

    expect(await listar(ctxDoGestor(a), { q: 'fulana' })).toMatchObject({ total: 0, itens: [] });
    expect(await listar(ctxDoGestor(a), { q: k.tel.slice(3) })).toMatchObject({ total: 0 });
    const d = await obter(ctxDoGestor(a), k.id);
    expect(d.cliente).toMatchObject({ nome: null, telefone: null, anonimizada: true });
    expect(d.totalReservas).toBe(3);
  });

  it('cliente sem reservas nem mensagens também é anonimizada', async () => {
    const { rows } = await c.query<{ id: string }>(
      "INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, 'Sem Nada', $2) RETURNING id::text AS id",
      [a.salaoId, telefone()],
    );
    expect(await anonimizar(a, rows[0].id)).toEqual({ resultado: 'anonimizada', canceladas: 0 });
  });
});

describe('CA-4 e CA-6: número liberado e imutabilidade', () => {
  it('upsert com o número antigo cria cliente nova; a anonimizada continua intacta; duas anonimizadas coexistem', async () => {
    const k = await clienteComReserva(a);
    await anonimizar(a, k.id);
    const r = await upsertCliente(ctxDoGestor(a), { telefone: k.tel, nome: 'Nova Dona' });
    expect(r).toMatchObject({ resultado: 'ok', criada: true });
    if (r.resultado !== 'ok') throw new Error('esperado ok');
    expect(r.cliente.id).not.toBe(k.id);
    expect(await linhaCliente(c, k.id)).toMatchObject({ nome: null, telefone_e164: null });
    const outra = await clienteComReserva(a);
    await anonimizar(a, outra.id);
    expect(await linhaCliente(c, outra.id)).toMatchObject({ nome: null });
  });

  it('CHECK rejeita repreencher nome ou telefone da anonimizada (23514)', async () => {
    const k = await clienteComReserva(a);
    await anonimizar(a, k.id);
    await expect(c.query("UPDATE cliente SET nome = 'x' WHERE id = $1", [k.id])).rejects.toMatchObject({ code: '23514' });
    await expect(c.query('UPDATE cliente SET telefone_e164 = $2 WHERE id = $1', [k.id, k.tel])).rejects.toMatchObject({ code: '23514' });
    await expect(c.query('UPDATE cliente SET anonimizada_em = NULL WHERE id = $1', [k.id])).rejects.toMatchObject({ code: '23514' });
  });
});

describe('CA-3, CA-5, CA-8: mensagens', () => {
  it('pendente, falhou e convite pendente viram cancelada_anonimizacao; os demais mantêm o estado; nenhuma ocorrência do telefone', async () => {
    const k = await clienteComReserva(a);
    const nacional = k.tel.slice(3);
    const base = { salaoId: a.salaoId, reservaId: k.reservaId };
    const pendente = await criarMensagem({ ...base, tipo: 'confirmacao', estado: 'pendente', destinatarioE164: k.tel });
    const falhou = await criarMensagem({ ...base, tipo: 'remarcacao', revisao: 1, estado: 'falhou', erroCodigo: 'erro_x', destinatarioE164: k.tel });
    const convite = await criarMensagem({ ...base, tipo: 'convite_avaliacao', estado: 'pendente', destinatarioE164: k.tel });
    const enviada = await criarMensagem({
      ...base,
      tipo: 'cancelamento',
      revisao: 1,
      estado: 'enviada',
      destinatarioE164: k.tel,
      provedorMensagemId: 'wamid.X',
      enviadaEm: new Date('2026-11-20T10:00:00Z'),
    });
    const nao = await criarMensagem({ ...base, tipo: 'cancelamento', revisao: 2, estado: 'nao_enviada', erroCodigo: 'sem_consentimento' });
    await c.query('UPDATE mensagem SET parametros = $2::jsonb WHERE id = ANY($1::uuid[])', [
      [pendente, falhou, convite, enviada],
      JSON.stringify({ telefone: k.tel, link: `https://x/${nacional}` }),
    ]);
    await tentativa(falhou, 1, `recusado para ${k.tel}`);
    await tentativa(enviada, 1, `eco ${nacional}`, 'falha');
    await tentativa(enviada, 2, null, 'sucesso');
    expect(await ocorrencias(a.salaoId, k.tel)).toBeGreaterThan(0);

    const r = await anonimizar(a, k.id);
    expect(r).toEqual({ resultado: 'anonimizada', canceladas: 3 });

    const { rows } = await c.query<Record<string, unknown>>(
      'SELECT id::text AS id, estado::text AS estado, destinatario_e164, parametros, erro_codigo, provedor_mensagem_id, atualizado_em FROM mensagem WHERE reserva_id = $1',
      [k.reservaId],
    );
    const por = Object.fromEntries(rows.map((l) => [l.id as string, l]));
    expect(por[pendente].estado).toBe('cancelada_anonimizacao');
    expect(por[falhou].estado).toBe('cancelada_anonimizacao');
    expect(por[convite].estado).toBe('cancelada_anonimizacao');
    expect(por[enviada].estado).toBe('enviada');
    expect(por[nao].estado).toBe('nao_enviada');
    for (const id of [pendente, falhou, convite, enviada]) {
      expect(por[id].destinatario_e164).toBeNull();
      expect(por[id].parametros).toBeNull();
    }
    expect(por[falhou].erro_codigo).toBe('erro_x');
    expect(por[enviada].provedor_mensagem_id).toBe('wamid.X');
    expect((por[pendente].atualizado_em as Date).toISOString()).toBe(AGORA.toISOString());
    const t = await c.query<{ n: string }>(
      'SELECT count(*) AS n FROM mensagem_tentativa WHERE mensagem_id = ANY($1::uuid[])',
      [[falhou, enviada]],
    );
    expect(Number(t.rows[0].n)).toBe(3);
    expect(await ocorrencias(a.salaoId, k.tel)).toBe(0);
  });

  it('o reenvio da falhou anonimizada é recusado e nada é enviado', async () => {
    const k = await clienteComReserva(a);
    const falhou = await criarMensagem({ salaoId: a.salaoId, reservaId: k.reservaId, estado: 'falhou', erroCodigo: 'erro_x', destinatarioE164: k.tel });
    await anonimizar(a, k.id);
    const enfileirar = vi.fn();
    // já cancelada pela anonimização: não é mais reenviável
    expect(await reenviarMensagem(ctxDoGestor(a), falhou, AGORA, { enfileirar })).toMatchObject({ resultado: 'recusada', motivo: 'nao_falhou' });
    // e, mesmo que uma falhou sobrevivesse (anonimização feita por fora), o reenvio recusa pela cliente
    const k2 = await clienteComReserva(a);
    const sobra = await criarMensagem({ salaoId: a.salaoId, reservaId: k2.reservaId, estado: 'falhou', erroCodigo: 'erro_x' });
    await c.query('UPDATE cliente SET nome = NULL, telefone_e164 = NULL, anonimizada_em = now() WHERE id = $1', [k2.id]);
    expect(await reenviarMensagem(ctxDoGestor(a), sobra, AGORA, { enfileirar })).toMatchObject({ resultado: 'recusada', motivo: 'cliente_anonimizada' });
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('mensagens de outras clientes e de outro salão ficam intactas', async () => {
    const k = await clienteComReserva(a);
    const outra = await clienteComReserva(a);
    const deB = await clienteComReserva(b, k.tel);
    for (const x of [k, outra, deB]) {
      await criarMensagem({ salaoId: x === deB ? b.salaoId : a.salaoId, reservaId: x.reservaId, estado: 'pendente', destinatarioE164: x.tel });
    }
    const antes = await Promise.all([a, b].map((s) => fotografiaReservas(c, s.salaoId)));
    await anonimizar(a, k.id);
    const depois = await Promise.all([a, b].map((s) => fotografiaReservas(c, s.salaoId)));
    expect(depois[1]).toEqual(antes[1]);
    const o = await c.query<{ estado: string; destinatario_e164: string }>('SELECT estado::text, destinatario_e164 FROM mensagem WHERE reserva_id = $1', [outra.reservaId]);
    expect(o.rows[0]).toEqual({ estado: 'pendente', destinatario_e164: outra.tel });
    expect(await linhaCliente(c, deB.id)).toMatchObject({ telefone_e164: k.tel });
  });
});

describe('CA-7: mensagem enviando', () => {
  it('mantém o estado e limpa o destinatário; o T2 de sucesso e o de falha não trazem dado pessoal de volta', async () => {
    for (const desfecho of ['sucesso', 'falha'] as const) {
      const k = await clienteComReserva(a);
      const m = await criarMensagem({ salaoId: a.salaoId, reservaId: k.reservaId, estado: 'enviando', destinatarioE164: k.tel });
      await c.query('UPDATE mensagem SET parametros = $2::jsonb WHERE id = $1', [m, JSON.stringify({ telefone: k.tel })]);
      const tid = await tentativa(m, 1, null, null);

      await anonimizar(a, k.id);
      const { rows } = await c.query<{ estado: string; destinatario_e164: string | null; parametros: unknown }>(
        'SELECT estado::text, destinatario_e164, parametros FROM mensagem WHERE id = $1',
        [m],
      );
      expect(rows[0]).toEqual({ estado: 'enviando', destinatario_e164: null, parametros: null });

      const sistema = repoMensagemSistema();
      const escreveu = await sistema.concluirEnvio(
        a.salaoId,
        m,
        tid,
        desfecho === 'sucesso'
          ? { resultado: 'sucesso', provedorMensagemId: 'wamid.Z' }
          : { resultado: 'falha', estadoFinal: 'falhou', erroCodigo: 'erro_x', erroDetalhe: 'falha permanente' },
        AGORA,
      );
      expect(escreveu).toBe(true);
      const f = await c.query<{ estado: string; destinatario_e164: string | null }>('SELECT estado::text, destinatario_e164 FROM mensagem WHERE id = $1', [m]);
      expect(f.rows[0]).toEqual({ estado: desfecho === 'sucesso' ? 'enviada' : 'falhou', destinatario_e164: null });
      expect(await ocorrencias(a.salaoId, k.tel)).toBe(0);
    }
  });
});

describe('CA-9: isolamento e permissões', () => {
  it('gestor de outro salão e id malformado: 404 e nada muda; profissional 403; anônimo 401', async () => {
    const k = await clienteComReserva(a);
    await criarMensagem({ salaoId: a.salaoId, reservaId: k.reservaId, estado: 'pendente', destinatarioE164: k.tel });
    const antes = { cliente: await linhaCliente(c, k.id), tudo: await fotografiaReservas(c, a.salaoId) };

    expect(await acoes.anonimizarCliente.executar(await credGestor(b), { clienteId: k.id })).toEqual(NAO_ENCONTRADO);
    expect(await acoes.anonimizarCliente.executar(await credGestor(a), { clienteId: 'nao-e-uuid' })).toEqual(NAO_ENCONTRADO);
    expect(await acoes.anonimizarCliente.executar(await credGestor(a), { clienteId: UUID_INEXISTENTE })).toEqual(NAO_ENCONTRADO);
    expect(await acoes.anonimizarCliente.executar(await credGestor(a), { clienteId: 42 })).toEqual(NAO_ENCONTRADO);
    expect(await acoes.anonimizarCliente.executar(await credProfissional(a), { clienteId: k.id })).toEqual(ACESSO_NEGADO);
    expect(await acoes.anonimizarCliente.executar({ token: 'x'.repeat(40) } as never, { clienteId: k.id })).toEqual(NAO_AUTENTICADO);

    expect({ cliente: await linhaCliente(c, k.id), tudo: await fotografiaReservas(c, a.salaoId) }).toEqual(antes);
  });

  it('a ação é de gestor com a capacidade lgpd', () => {
    expect(metadadosDaAcao(acoes.anonimizarCliente)).toEqual({ papeis: ['gestor'], capacidade: 'lgpd' });
  });

  it('pelo serviço, id de outro salão lança NaoEncontrado', async () => {
    const k = await clienteComReserva(a);
    await expect(anonimizar(b, k.id)).rejects.toBeInstanceOf(NaoEncontrado);
  });
});

describe('CA-10: idempotência (sequencial)', () => {
  it('a segunda chamada é recusada e não escreve (anonimizada_em intacto)', async () => {
    const k = await clienteComReserva(a);
    const cred = await credGestor(a);
    const primeira = await acoes.anonimizarCliente.executar(cred, { clienteId: k.id }, { agora: AGORA });
    expect(primeira).toEqual({ ok: true, dados: { resultado: 'anonimizada', canceladas: 0 } });
    const linha = await linhaCliente(c, k.id);
    const segunda = await acoes.anonimizarCliente.executar(cred, { clienteId: k.id }, { agora: new Date(AGORA.getTime() + 3_600_000) });
    expect(segunda).toEqual({ ok: true, dados: { resultado: 'recusado', motivo: 'ja_anonimizada' } });
    expect(await linhaCliente(c, k.id)).toEqual(linha);
  });
});

describe('CA-12: atomicidade', () => {
  it.each(['aposTravar', 'aposCliente', 'aposMensagens', 'aoAnonimizar'] as const)('falha forçada em %s desfaz tudo', async (ponto) => {
    const k = await clienteComReserva(a);
    const m = await criarMensagem({ salaoId: a.salaoId, reservaId: k.reservaId, estado: 'pendente', destinatarioE164: k.tel });
    await tentativa(m, 1, `eco ${k.tel}`);
    const antes = { cliente: await linhaCliente(c, k.id), tudo: await fotografiaReservas(c, a.salaoId) };
    const falha = async () => {
      throw new Error('falha forçada');
    };
    await expect(anonimizar(a, k.id, { [ponto]: falha })).rejects.toThrow('falha forçada');
    expect({ cliente: await linhaCliente(c, k.id), tudo: await fotografiaReservas(c, a.salaoId) }).toEqual(antes);
    expect(await ocorrencias(a.salaoId, k.tel)).toBeGreaterThan(0);
    // e a cliente continua anonimizável depois
    expect(await anonimizar(a, k.id)).toMatchObject({ resultado: 'anonimizada' });
  });
});

describe('CA-14: gancho aoAnonimizar', () => {
  it('roda na mesma transação, depois da limpeza, com os argumentos certos; sem ele nada muda', async () => {
    const k = await clienteComReserva(a);
    const m = await criarMensagem({ salaoId: a.salaoId, reservaId: k.reservaId, estado: 'pendente', destinatarioE164: k.tel });
    const visto: Record<string, unknown> = {};
    const r = await anonimizar(a, k.id, {
      aoAnonimizar: async (ctx, d, repos) => {
        visto.args = { salaoId: ctx.salaoId, clienteId: d.clienteId, agora: d.agora.toISOString() };
        // dentro da transação já se vê a cliente anonimizada...
        visto.dentro = (await repos.clientes.buscarPorId(ctx, d.clienteId)).anonimizadaEm !== null;
        // ...e a limpeza das mensagens (que roda antes do gancho)
        const { canceladas } = await repos.mensagens.anonimizarDaCliente(ctx, d.clienteId, d.agora);
        visto.jaLimpas = canceladas;
        // ...enquanto outra conexão ainda não vê nada (nada foi confirmado)
        visto.fora = (await linhaCliente(c, k.id)).anonimizada_em;
      },
    });
    expect(r).toMatchObject({ resultado: 'anonimizada', canceladas: 1 });
    expect(visto).toEqual({
      args: { salaoId: a.salaoId, clienteId: k.id, agora: AGORA.toISOString() },
      dentro: true,
      jaLimpas: 0,
      fora: null,
    });
    const { rows } = await c.query<{ estado: string }>('SELECT estado::text FROM mensagem WHERE id = $1', [m]);
    expect(rows[0].estado).toBe('cancelada_anonimizacao');
  });

  it('na repetição o gancho não é chamado', async () => {
    const k = await clienteComReserva(a);
    await anonimizar(a, k.id);
    const gancho = vi.fn();
    expect(await anonimizar(a, k.id, { aoAnonimizar: gancho })).toEqual({ resultado: 'recusado', motivo: 'ja_anonimizada' });
    expect(gancho).not.toHaveBeenCalled();
  });
});

describe('CA-15: salão suspenso', () => {
  it('a capacidade lgpd é permitida mesmo quando a política bloqueia o resto', async () => {
    await c.query('UPDATE salao SET suspenso_manual_em = now() WHERE id = $1', [b.salaoId]);
    try {
      const k = await clienteComReserva(b);
      const politica = (_ctx: unknown, capacidade: string) =>
        capacidade === 'lgpd' ? { permitido: true as const } : { permitido: false as const, motivo: 'suspenso' };
      const cred = await credGestor(b);
      expect(await acoes.editarCliente.executar(cred, { id: k.id, nome: 'Outro', telefone: k.tel }, { politica })).toMatchObject({ ok: false });
      const r = await acoes.anonimizarCliente.executar(cred, { clienteId: k.id }, { politica });
      expect(r).toEqual({ ok: true, dados: { resultado: 'anonimizada', canceladas: 0 } });
    } finally {
      await c.query('UPDATE salao SET suspenso_manual_em = NULL WHERE id = $1', [b.salaoId]);
    }
  });
});

describe('RN-2: reservas futuras e registro posterior', () => {
  it('uma mensagem registrada depois da anonimização nasce cancelada_anonimizacao (via serviço de mensagens)', async () => {
    const { registrarMensagem } = await import('@/server/mensagens/registrar');
    const k = await clienteComReserva(a);
    await anonimizar(a, k.id);
    const r = await emTransacao((t) => registrarMensagem(ctxDoGestor(a), { reservaId: k.reservaId, tipo: 'confirmacao' }, AGORA, t));
    const { rows } = await c.query<{ estado: string; destinatario_e164: string | null }>('SELECT estado::text, destinatario_e164 FROM mensagem WHERE id = $1', [r.mensagemId]);
    expect(rows[0]).toEqual({ estado: 'cancelada_anonimizacao', destinatario_e164: null });
    expect(MENSAGENS_CLIENTE.removida).toBe('Cliente removida');
  });
});
