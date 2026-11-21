import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import type { GeradorLinkAvaliacao } from '@/server/mensagens/tipos';
import { obterPrisma } from '@/server/repos/db';

import {
  capturarConsole,
  chamadasDaChave,
  checksumDeTabelas,
  criarCenarioMensagem,
  lerMensagem,
  lerTentativas,
  TABELAS_INTOCAVEIS,
} from '../../support/mensagens';

import { criarPipeline, esperarJob, esperarMensagem, limparFalhasForcadas, registrar, registrarEEnfileirar } from './apoio';
import type { Pipeline } from './apoio';

// D-024 T-7: convite_avaliacao (CA-11, CA-12). O link é um valor único reconhecível; ele só pode aparecer
// como parâmetro recebido pelo adaptador simulado (o "provedor" de teste).

const LINK = `https://app.exemplo.test/avaliar/${randomUUID()}`;
const gerador: GeradorLinkAvaliacao = async () => LINK;
let p: Pipeline;

afterEach(limparFalhasForcadas);
afterAll(async () => {
  await p?.encerrar();
});

/** Texto de tudo que o pipeline grava ou registra, menos o adaptador simulado. */
async function textoPersistido(): Promise<string> {
  const db = obterPrisma();
  const partes = await db.$queryRaw<{ t: string }[]>`
    SELECT to_jsonb(x)::text AS t FROM mensagem x
    UNION ALL SELECT to_jsonb(x)::text FROM mensagem_tentativa x
    UNION ALL SELECT to_jsonb(x)::text FROM pgboss.job x
    UNION ALL SELECT to_jsonb(x)::text FROM pgboss.queue x`;
  return partes.map((x) => x.t).join('\n');
}

describe('CA-11: mesmo pipeline, link nunca gravado nem registrado', () => {
  beforeAll(async () => {
    p = await criarPipeline({ gerarLink: gerador });
  }, 60_000);

  it('enviando, tentativa registrada, retry com backoff numa falha forçada e enviada no fim; o link só chega ao adaptador', async () => {
    const s = await criarCenarioMensagem({ status: 'concluido', consentimentoConvite: true });
    await p.simulado.forcarFalhas(1, 'temporaria');
    const log = capturarConsole();
    let r;
    try {
      r = await registrarEEnfileirar(p, s, 'convite_avaliacao');
      await esperarMensagem(r.mensagemId, 'enviada', 30_000);
    } finally {
      log.restaurar();
    }
    expect(r.chave).toBe(`${s.reservaId}:convite_avaliacao:0`);
    const t = await lerTentativas(r.mensagemId);
    expect(t.map((x) => x.resultado)).toEqual(['falha', 'sucesso']);
    const chamadas = await chamadasDaChave(r.chave);
    expect(chamadas).toHaveLength(2);
    expect(chamadas.every((c) => c.modelo === 'convite_avaliacao' && c.parametros.link === LINK && c.parametros.salao === s.salaoNome)).toBe(true);

    const m = await lerMensagem(r.mensagemId);
    expect(JSON.stringify(m)).not.toContain(LINK);
    expect(m.parametros).toBeNull();
    expect(await textoPersistido()).not.toContain(LINK);
    expect(p.logs().join('\n')).not.toContain(LINK);
    expect(log.linhas.join('\n')).not.toContain(LINK);
    expect(p.logs().join('\n')).not.toContain(s.telefone);
  }, 40_000);

  it('o job do pg-boss leva só { mensagemId }', async () => {
    const s = await criarCenarioMensagem({ status: 'concluido', consentimentoConvite: true });
    const r = await registrarEEnfileirar(p, s, 'convite_avaliacao');
    const job = await obterPrisma().$queryRaw<{ data: unknown }[]>`SELECT data FROM pgboss.job WHERE id = ${p.jobs.at(-1)!}::uuid`;
    expect(job[0].data).toEqual({ mensagemId: r.mensagemId });
    await esperarMensagem(r.mensagemId, 'enviada');
  });

  it('gerador que falha com o link na mensagem → link_indisponivel, sem vazar', async () => {
    await p.encerrar();
    p = await criarPipeline({ gerarLink: async () => { throw new Error(`falha ${LINK}`); } });
    const s = await criarCenarioMensagem({ status: 'concluido', consentimentoConvite: true });
    const r = await registrarEEnfileirar(p, s, 'convite_avaliacao');
    const m = await esperarMensagem(r.mensagemId, 'falhou');
    expect(m.erroCodigo).toBe('link_indisponivel');
    expect(await chamadasDaChave(r.chave)).toEqual([]);
    expect(await textoPersistido()).not.toContain(LINK);
    expect(p.logs().join('\n')).not.toContain(LINK);
  });

  it('gerador padrão do worker (D-032) sem convite possível (salão sem slug atual) → falhou/link_indisponivel', async () => {
    await p.encerrar();
    p = await criarPipeline();
    const s = await criarCenarioMensagem({ status: 'concluido', consentimentoConvite: true });
    const r = await registrarEEnfileirar(p, s, 'convite_avaliacao');
    const m = await esperarMensagem(r.mensagemId, 'falhou');
    expect(m.erroCodigo).toBe('link_indisponivel');
    expect((await lerTentativas(r.mensagemId)).map((t) => [t.resultado, t.erroCodigo])).toEqual([['falha', 'link_indisponivel']]);
  });
});

describe('CA-12: duplicidade e esgotamento', () => {
  it('registrado duas vezes e job entregue duas vezes → 1 mensagem e 1 chamada', async () => {
    await p.encerrar();
    p = await criarPipeline({ gerarLink: gerador });
    const s = await criarCenarioMensagem({ status: 'concluido', consentimentoConvite: true });
    const r1 = await registrar(s, 'convite_avaliacao');
    const r2 = await registrar(s, 'convite_avaliacao');
    expect(r2).toMatchObject({ criada: false, mensagemId: r1.mensagemId });
    await enfileirarMensagens([r1, r2], { enfileirar: p.enfileirar });
    await esperarMensagem(r1.mensagemId, 'enviada');
    const primeiro = p.jobs.at(-1)!;
    await esperarJob(p, 'whatsapp-reserva', primeiro);
    // entrega repetida do mesmo job (a chave já foi liberada pelo término do primeiro)
    const repetido = await p.enfileirar('whatsapp-reserva', { mensagemId: r1.mensagemId }, { chave: r1.chave });
    if (repetido.criado) await esperarJob(p, 'whatsapp-reserva', repetido.id);
    expect(await chamadasDaChave(r1.chave)).toHaveLength(1);
    expect(await lerTentativas(r1.mensagemId)).toHaveLength(1);
  }, 40_000);

  it('adaptador falhando até esgotar: reserva continua concluida e inalterada, mensagem falhou', async () => {
    await p.encerrar();
    p = await criarPipeline({ gerarLink: gerador, env: { QUEUE_RETRY_LIMIT: '1', QUEUE_RETRY_BACKOFF: 'false' } });
    const s = await criarCenarioMensagem({ status: 'concluido', consentimentoConvite: true });
    const antes = await checksumDeTabelas(TABELAS_INTOCAVEIS, s.salaoId);
    await p.simulado.forcarFalhas(4, 'temporaria');
    const r = await registrarEEnfileirar(p, s, 'convite_avaliacao');
    const m = await esperarMensagem(r.mensagemId, 'falhou', 30_000);
    expect(m.erroCodigo).toBe('falha_forcada');
    expect(await lerTentativas(r.mensagemId)).toHaveLength(2);
    const reserva = await obterPrisma().reserva.findUniqueOrThrow({ where: { id: s.reservaId } });
    expect(reserva.status).toBe('concluido');
    expect(await checksumDeTabelas(TABELAS_INTOCAVEIS, s.salaoId)).toEqual(antes);
    expect(await textoPersistido()).not.toContain(LINK);
  }, 40_000);
});
