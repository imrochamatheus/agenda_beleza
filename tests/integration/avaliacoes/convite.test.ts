import { createHash } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { segredoDeAvaliacao } from '@/server/avaliacoes/config';
import { gerarToken } from '@/server/avaliacoes/token';
import { validarEnv } from '@/server/env';
import { obterPrisma } from '@/server/repos/db';

import { capturarConsole, chamadasDaChave, criarCenarioMensagem, lerMensagem, lerTentativas } from '../../support/mensagens';
import { conectar, slugNovo } from '../../support/sql';
import { criarPipeline, esperarMensagem, registrarEEnfileirar } from '../mensagens/apoio';
import type { Pipeline } from '../mensagens/apoio';

import { AGORA, DIA_MS, SEGREDO_TESTE, ctxSistema, conviteDe, criarAvaliavel, emitirLink, gerador, salaoNovo } from './apoio';

// D-032 T-3: gerador do link (CA-1, CA-2) e o pipeline real (worker pg-boss + WhatsApp simulado) com o
// gerador PADRÃO do handler. O token só pode aparecer como parâmetro recebido pelo adaptador simulado.

let c: pg.Client;
let p: Pipeline;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await p?.encerrar();
  await c.end();
});

async function textoPersistido(): Promise<string> {
  const partes = await obterPrisma().$queryRaw<{ t: string }[]>`
    SELECT to_jsonb(x)::text AS t FROM mensagem x
    UNION ALL SELECT to_jsonb(x)::text FROM mensagem_tentativa x
    UNION ALL SELECT to_jsonb(x)::text FROM pgboss.job x`;
  return partes.map((x) => x.t).join('\n');
}

describe('gerador do link (CA-2, RN-2, RN-3, RN-5)', () => {
  it('o link é APP_URL/slug/avaliar/token; só o hash fica gravado; validade de 30 dias', async () => {
    const s = await salaoNovo();
    const k = await criarAvaliavel(c, s);
    const { link, token } = await emitirLink(s, k.reservaId);
    expect(link).toBe(`https://app.exemplo.test/${s.slugAtual}/avaliar/${token}`);
    expect(token).toBe(gerarToken(SEGREDO_TESTE, s.salaoId, k.reservaId));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cv = await conviteDe(c, k.reservaId);
    expect(cv).toMatchObject({ token_hash: createHash('sha256').update(token).digest('hex'), usado_em: null, invalidado_em: null });
    expect(new Date(cv?.expira_em as string)).toEqual(new Date(AGORA.getTime() + 30 * DIA_MS));
    expect(JSON.stringify(cv)).not.toContain(token);
  });

  it('CA-2: regerar (reenvio/retentativa) devolve o mesmo link, uma só linha e a validade não renova', async () => {
    const s = await salaoNovo();
    const k = await criarAvaliavel(c, s);
    const a = await emitirLink(s, k.reservaId);
    const depois = new Date(AGORA.getTime() + 10 * DIA_MS);
    const b = await emitirLink(s, k.reservaId, depois);
    expect(b.link).toBe(a.link);
    const { rows } = await c.query('SELECT expira_em FROM avaliacao_convite WHERE reserva_id = $1', [k.reservaId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].expira_em).toEqual(new Date(AGORA.getTime() + 30 * DIA_MS));
  });

  it('usa o slug ATUAL e o token difere entre reservas e entre salões', async () => {
    const s = await salaoNovo();
    const k1 = await criarAvaliavel(c, s);
    const k2 = await criarAvaliavel(c, s);
    const l1 = await emitirLink(s, k1.reservaId);
    const l2 = await emitirLink(s, k2.reservaId);
    expect(l1.token).not.toBe(l2.token);
    expect(l1.link.startsWith(`https://app.exemplo.test/${s.slugAtual}/`)).toBe(true);
    expect(gerarToken(SEGREDO_TESTE, s.salaoId, k1.reservaId)).not.toBe(gerarToken(SEGREDO_TESTE, '00000000-0000-4000-8000-000000000009', k1.reservaId));
  });

  it('segredo diferente muda o token (rotação invalida os links não usados)', () => {
    expect(gerarToken('x'.repeat(32), 's', 'r')).not.toBe(gerarToken('y'.repeat(32), 's', 'r'));
  });

  it.each([
    ['confirmado', 'confirmado'],
    ['cancelado', 'cancelado'],
    ['nao_compareceu', 'nao_compareceu'],
  ] as const)('reserva %s: lança e não cria convite', async (_n, status) => {
    const s = await salaoNovo();
    const k = await criarAvaliavel(c, s, { status });
    await expect(gerador()(ctxSistema(s), k.reservaId)).rejects.toThrow();
    expect(await conviteDe(c, k.reservaId)).toBeUndefined();
  });

  it('cliente anonimizada, reserva de outro salão e id malformado: lança e não cria convite', async () => {
    const s = await salaoNovo();
    const outro = await salaoNovo();
    const anon = await criarAvaliavel(c, s);
    await c.query('UPDATE cliente SET nome = NULL, telefone_e164 = NULL, anonimizada_em = now() WHERE id = $1', [anon.clienteId]);
    await expect(gerador()(ctxSistema(s), anon.reservaId)).rejects.toThrow();
    const doOutro = await criarAvaliavel(c, outro);
    await expect(gerador()(ctxSistema(s), doOutro.reservaId)).rejects.toThrow();
    await expect(gerador()(ctxSistema(s), 'nao-e-uuid')).rejects.toThrow();
    expect(await conviteDe(c, anon.reservaId)).toBeUndefined();
    expect(await conviteDe(c, doOutro.reservaId)).toBeUndefined();
  });
});

describe('CA-1: worker real com o gerador padrão', () => {
  beforeAll(async () => {
    p = await criarPipeline();
  }, 60_000);

  it('o adaptador recebe o link correto; só o hash fica no banco; token fora de mensagem, tentativas, job e logs', async () => {
    const s = await criarCenarioMensagem({ status: 'concluido', consentimentoConvite: true });
    const slug = slugNovo();
    await obterPrisma().salaoSlug.create({ data: { slug, salaoId: s.salaoId, atual: true } });
    const token = gerarToken(segredoDeAvaliacao(), s.salaoId, s.reservaId);
    const esperado = `${validarEnv(process.env).APP_URL.replace(/\/+$/, '')}/${slug}/avaliar/${token}`;

    const log = capturarConsole();
    let r;
    try {
      r = await registrarEEnfileirar(p, s, 'convite_avaliacao');
      await esperarMensagem(r.mensagemId, 'enviada', 30_000);
    } finally {
      log.restaurar();
    }
    const chamadas = await chamadasDaChave(r.chave);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ modelo: 'convite_avaliacao' });
    expect(chamadas[0].parametros.link).toBe(esperado);

    const { rows } = await c.query('SELECT token_hash, usado_em FROM avaliacao_convite WHERE reserva_id = $1', [s.reservaId]);
    expect(rows).toEqual([{ token_hash: createHash('sha256').update(token).digest('hex'), usado_em: null }]);

    const m = await lerMensagem(r.mensagemId);
    expect(m.parametros).toBeNull();
    expect(JSON.stringify(m)).not.toContain(token);
    expect(JSON.stringify(await lerTentativas(r.mensagemId))).not.toContain(token);
    expect(await textoPersistido()).not.toContain(token);
    expect(p.logs().join('\n')).not.toContain(token);
    expect(log.linhas.join('\n')).not.toContain(token);
    expect((await obterPrisma().$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.queue x WHERE to_jsonb(x)::text LIKE ${'%' + token + '%'}`)[0].n).toBe(0);
  });

  it('CA-2: nova tentativa do mesmo convite usa o mesmo link e mantém uma só linha de convite', async () => {
    const s = await criarCenarioMensagem({ status: 'concluido', consentimentoConvite: true });
    await obterPrisma().salaoSlug.create({ data: { slug: slugNovo(), salaoId: s.salaoId, atual: true } });
    await p.simulado.forcarFalhas(1, 'temporaria');
    const r = await registrarEEnfileirar(p, s, 'convite_avaliacao');
    await esperarMensagem(r.mensagemId, 'enviada', 40_000);
    const chamadas = await chamadasDaChave(r.chave);
    expect(chamadas.length).toBeGreaterThanOrEqual(1);
    expect(new Set(chamadas.map((x) => x.parametros.link)).size).toBe(1);
    expect((await c.query('SELECT 1 FROM avaliacao_convite WHERE reserva_id = $1', [s.reservaId])).rowCount).toBe(1);
  }, 50_000);
});
