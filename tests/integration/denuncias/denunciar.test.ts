import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { lerAvaliacoesPublicas } from '@/server/avaliacoes/leitura';
import { denunciarAvaliacao } from '@/server/denuncias/denunciar';
import { TETO_PENDENTES } from '@/server/denuncias/tipos';
import { hashIpDenuncia } from '@/server/protecao/chaves';
import { limitarPorIp } from '@/server/protecao/limite';
import { criarPublicoContext } from '@/server/tenant/context';

import { AGORA, criarAvaliacao, denunciasDe, entradaDenuncia, linhaDaAvaliacao, semearPendentes, SEMPRE_PERMITIDO, totalDeDenuncias } from '../../support/denuncias';
import { ipNovo } from '../../support/reserva-publica';
import { conectar } from '../../support/sql';
import { ctxPublico, salaoNovo } from '../avaliacoes/apoio';

// D-035 CA-1, CA-3, CA-4, CA-5: denúncia pública contra o PostgreSQL real, com Turnstile simulado.
let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const RECEBIDA = { resultado: 'recebida' };

describe('CA-1: denúncia registrada e a avaliação segue visível', () => {
  it('grava 1 linha com motivo, texto e ip_hash que não é o IP; a avaliação continua em /{slug}', async () => {
    const s = await salaoNovo();
    const { avaliacaoId } = await criarAvaliacao(c, s);
    const ip = ipNovo();
    const r = await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { ip, motivo: 'ofensivo', texto: '  Texto   com espaços  ' }), AGORA);
    expect(r).toEqual(RECEBIDA);
    const linhas = await denunciasDe(c, avaliacaoId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ salao_id: s.salaoId, motivo: 'ofensivo', texto: 'Texto com espaços', resolvida_em: null, resolucao: null });
    expect(linhas[0].ip_hash).toBe(hashIpDenuncia(ip));
    expect(linhas[0].ip_hash).not.toContain(ip);
    const pub = await lerAvaliacoesPublicas(ctxPublico(s));
    expect(pub.total).toBe(1);
    expect(pub.itens[0].id).toBe(avaliacaoId);
    expect((await linhaDaAvaliacao(c, avaliacaoId)).retirada_em).toBeNull();
  });

  it('texto vazio vira NULL (nunca string vazia)', async () => {
    const s = await salaoNovo();
    const { avaliacaoId } = await criarAvaliacao(c, s);
    expect(await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { texto: '   ' }), AGORA)).toEqual(RECEBIDA);
    expect((await denunciasDe(c, avaliacaoId))[0].texto).toBeNull();
  });
});

describe('CA-3: recusas sem gravar', () => {
  it('Turnstile reprovado, motivo fora da lista e texto > 500 não gravam; cada erro é o previsto', async () => {
    const s = await salaoNovo();
    const { avaliacaoId } = await criarAvaliacao(c, s);
    const antes = await totalDeDenuncias(c);
    expect(await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { ip: ipNovo(), tokenHumano: 'token-ruim' }), AGORA)).toEqual({ resultado: 'humano' });
    expect(await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { ip: ipNovo(), tokenHumano: null }), AGORA)).toEqual({ resultado: 'humano' });
    const m = await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { ip: ipNovo(), motivo: 'inexistente' }), AGORA);
    expect(m).toMatchObject({ resultado: 'invalido', erros: { motivo: expect.any(String) } });
    const t = await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { ip: ipNovo(), texto: 'x'.repeat(501) }), AGORA);
    expect(t).toMatchObject({ resultado: 'invalido', erros: { texto: expect.any(String) } });
    expect(await totalDeDenuncias(c)).toBe(antes);
  });

  it('limite por IP no escopo denuncia: a K+1 é recusada sem gravar; reserva e avaliação não são afetadas', async () => {
    vi.stubEnv('PROTECAO_LIMITE_IP_DENUNCIA', '2');
    const s = await salaoNovo();
    const a1 = await criarAvaliacao(c, s);
    const a2 = await criarAvaliacao(c, s);
    const a3 = await criarAvaliacao(c, s);
    const ip = ipNovo();
    expect(await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(a1.avaliacaoId, { ip }), AGORA)).toEqual(RECEBIDA);
    expect(await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(a2.avaliacaoId, { ip }), AGORA)).toEqual(RECEBIDA);
    expect(await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(a3.avaliacaoId, { ip }), AGORA)).toEqual({ resultado: 'limitado' });
    expect(await denunciasDe(c, a3.avaliacaoId)).toHaveLength(0);
    expect((await limitarPorIp(ip, 'avaliacao', AGORA)).permitido).toBe(true);
    expect((await limitarPorIp(ip, 'reserva', AGORA)).permitido).toBe(true);
  });
});

describe('CA-4: dedupe e teto', () => {
  it('20 denúncias paralelas do mesmo IP gravam 1 linha, sem erro', async () => {
    const s = await salaoNovo();
    const { avaliacaoId } = await criarAvaliacao(c, s);
    const ip = ipNovo();
    const rs = await Promise.all(
      Array.from({ length: 20 }, () => denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { ip }), AGORA, { limitarPorIp: SEMPRE_PERMITIDO })),
    );
    expect(rs.every((r) => r.resultado === 'recebida')).toBe(true);
    expect(await denunciasDe(c, avaliacaoId)).toHaveLength(1);
  });

  it('IPs diferentes geram linhas diferentes; depois de resolvida, o mesmo IP pode denunciar de novo', async () => {
    const s = await salaoNovo();
    const { avaliacaoId } = await criarAvaliacao(c, s);
    const ip = ipNovo();
    await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { ip }), AGORA);
    await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { ip: ipNovo() }), AGORA);
    expect(await denunciasDe(c, avaliacaoId)).toHaveLength(2);
    await c.query(`UPDATE avaliacao_denuncia SET resolvida_em = now(), resolucao = 'mantida', resolvida_por = gen_random_uuid() WHERE avaliacao_id = $1`, [avaliacaoId]);
    await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { ip }), AGORA);
    expect(await denunciasDe(c, avaliacaoId)).toHaveLength(3);
  });

  it(`teto de ${TETO_PENDENTES} pendentes: a seguinte recebe a mesma resposta e não grava`, async () => {
    const s = await salaoNovo();
    const { avaliacaoId } = await criarAvaliacao(c, s);
    await semearPendentes(c, s, avaliacaoId, TETO_PENDENTES);
    expect(await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { ip: ipNovo() }), AGORA)).toEqual(RECEBIDA);
    expect(await denunciasDe(c, avaliacaoId)).toHaveLength(TETO_PENDENTES);
  });
});

describe('CA-5: resposta uniforme sem gravar', () => {
  it('retirada, de outro salão, inexistente, malformada, reserva não concluída e cliente anonimizada', async () => {
    const a = await salaoNovo();
    const b = await salaoNovo();
    const retirada = await criarAvaliacao(c, a, { retirada: true });
    const doA = await criarAvaliacao(c, a);
    const cancelada = await criarAvaliacao(c, a, { status: 'cancelado' });
    const anonimizada = await criarAvaliacao(c, a);
    await c.query(`UPDATE cliente SET anonimizada_em = now(), nome = NULL, telefone_e164 = NULL WHERE id = $1`, [anonimizada.clienteId]);
    const alvos: [string, ReturnType<typeof ctxPublico>][] = [
      [retirada.avaliacaoId, ctxPublico(a)],
      [doA.avaliacaoId, ctxPublico(b)],
      ['00000000-0000-4000-8000-000000000000', ctxPublico(a)],
      ['nao-e-uuid', ctxPublico(a)],
      ["'; DROP TABLE avaliacao; --", ctxPublico(a)],
      [cancelada.avaliacaoId, ctxPublico(a)],
      [anonimizada.avaliacaoId, ctxPublico(a)],
    ];
    const antes = await totalDeDenuncias(c);
    const respostas = [];
    for (const [id, ctx] of alvos) respostas.push(await denunciarAvaliacao(ctx, entradaDenuncia(id, { ip: ipNovo() }), AGORA));
    expect(respostas).toEqual(alvos.map(() => RECEBIDA));
    expect(await totalDeDenuncias(c)).toBe(antes);
    // O mesmo pedido válido no salão certo grava: a diferença é só a visibilidade.
    expect(await denunciarAvaliacao(ctxPublico(a), entradaDenuncia(doA.avaliacaoId, { ip: ipNovo() }), AGORA)).toEqual(RECEBIDA);
    expect(await denunciasDe(c, doA.avaliacaoId)).toHaveLength(1);
  });

  it('contexto público forjado de outro salão (slug trocado) continua só enxergando o próprio salão', async () => {
    const a = await salaoNovo();
    const b = await salaoNovo();
    const av = await criarAvaliacao(c, a);
    await denunciarAvaliacao(criarPublicoContext(b.salaoId, b.slugAtual), entradaDenuncia(av.avaliacaoId, { ip: ipNovo() }), AGORA);
    expect(await denunciasDe(c, av.avaliacaoId)).toHaveLength(0);
  });
});

describe('CA-13: nada enfileirado', () => {
  it('denunciar não cria mensagem nem e-mail', async () => {
    const s = await salaoNovo();
    const { avaliacaoId } = await criarAvaliacao(c, s);
    const q = async () => Number((await c.query('SELECT (SELECT count(*) FROM mensagem) + (SELECT count(*) FROM email_log) AS n')).rows[0].n);
    const antes = await q();
    await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { ip: ipNovo() }), AGORA);
    expect(await q()).toBe(antes);
  });
});
