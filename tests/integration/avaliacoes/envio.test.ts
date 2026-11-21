import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { VERSAO_TERMOS } from '@/config/termos';
import { lerAvaliacoesPublicas } from '@/server/avaliacoes/leitura';
import { verificarLink } from '@/server/avaliacoes/servico';
import { MENSAGENS_AVALIACAO } from '@/server/avaliacoes/tipos';
import { gerarToken } from '@/server/avaliacoes/token';
import { limitarPorIp } from '@/server/protecao/limite';
import { configDaProtecao } from '@/server/protecao/config';
import { TOKEN_INVALIDO_DE_TESTE } from '@/server/protecao/widget-tipos';

import type { SalaoCompleto } from '../../support/factories';
import { ipNovo } from '../../support/reserva-publica';
import { conectar } from '../../support/sql';

import {
  AGORA, DIA_MS, SEGREDO_TESTE, conviteDe, criarAvaliavel, ctxPublico, emitirLink, enviar, fotografia, salaoNovo,
} from './apoio';

// D-032 T-4: verificação e envio pelo link (CA-3, CA-4, CA-5, CA-6, CA-9, CA-12, CA-13, CA-14).
let c: pg.Client;
let s: SalaoCompleto;
let outro: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await salaoNovo();
  outro = await salaoNovo();
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

describe('CA-3: link válido', () => {
  it('grava 1 avaliação com nome de exibição e versão vigente, marca o convite e publica', async () => {
    const k = await criarAvaliavel(c, s, { nome: 'Maria da Silva Souza' });
    const { token } = await emitirLink(s, k.reservaId);
    const v = await verificarLink(s.slugAtual, token, ipNovo(), AGORA);
    expect(v).toEqual({ ok: true, nomeSalao: s.nome, slugAtual: s.slugAtual, historico: false });

    expect(await enviar(s, token, { nota: '4', comentario: '  Muito   bom\n atendimento ' }, AGORA)).toEqual({ resultado: 'enviada' });

    const { rows } = await c.query(
      `SELECT nota, comentario, nome_exibicao, versao_termos, cliente_id::text, publicacao_aceita_em, retirada_em
         FROM avaliacao WHERE reserva_id = $1`, [k.reservaId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      nota: 4, comentario: 'Muito bom atendimento', nome_exibicao: 'Maria S.', versao_termos: VERSAO_TERMOS,
      cliente_id: k.clienteId, retirada_em: null,
    });
    expect(rows[0].publicacao_aceita_em).toEqual(AGORA);
    expect(new Date((await conviteDe(c, k.reservaId))?.usado_em as string)).toEqual(AGORA);

    const pub = await lerAvaliacoesPublicas(ctxPublico(s));
    expect(pub.total).toBeGreaterThanOrEqual(1);
    expect(pub.itens.find((i) => i.nome === 'Maria S.' && i.comentario === 'Muito bom atendimento')).toMatchObject({ nota: 4, mesAno: 'novembro de 2026' });
    // O DTO público não traz identificadores de cliente ou reserva; só o id da própria avaliação (UUID
    // aleatório, D-035), usado pelo formulário de denúncia.
    expect(Object.keys(pub.itens[0]).sort()).toEqual(['comentario', 'id', 'mesAno', 'nome', 'nota']);
    expect(pub.itens[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('nota sem comentário é publicável; nome único fica só o nome', async () => {
    const k = await criarAvaliavel(c, s, { nome: 'Madonna' });
    const { token } = await emitirLink(s, k.reservaId);
    expect(await enviar(s, token, { comentario: '' })).toEqual({ resultado: 'enviada' });
    const { rows } = await c.query('SELECT comentario, nome_exibicao FROM avaliacao WHERE reserva_id = $1', [k.reservaId]);
    expect(rows[0]).toEqual({ comentario: null, nome_exibicao: 'Madonna' });
  });

  it('slug antigo (histórico) também aceita o envio (D-1)', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId);
    const v = await verificarLink(s.slugHistorico, token, ipNovo(), AGORA);
    expect(v).toMatchObject({ ok: true, historico: true, slugAtual: s.slugAtual });
    expect(await enviar({ slugAtual: s.slugHistorico }, token)).toEqual({ resultado: 'enviada' });
  });
});

describe('CA-4 e CA-5: link recusado de forma uniforme, nada gravado', () => {
  async function casos() {
    const usada = await criarAvaliavel(c, s);
    const tUsada = (await emitirLink(s, usada.reservaId)).token;
    await enviar(s, tUsada);

    const vencida = await criarAvaliavel(c, s);
    const tVencida = (await emitirLink(s, vencida.reservaId)).token;

    const naoConcluida = await criarAvaliavel(c, s, { status: 'concluido' });
    const tNaoConcluida = (await emitirLink(s, naoConcluida.reservaId)).token;
    await c.query("UPDATE reserva SET status = 'nao_compareceu' WHERE id = $1", [naoConcluida.reservaId]);

    const invalidada = await criarAvaliavel(c, s);
    const tInvalidada = (await emitirLink(s, invalidada.reservaId)).token;
    await c.query('UPDATE avaliacao_convite SET invalidado_em = now() WHERE reserva_id = $1', [invalidada.reservaId]);

    const anonima = await criarAvaliavel(c, s);
    const tAnonima = (await emitirLink(s, anonima.reservaId)).token;
    await c.query('UPDATE cliente SET nome = NULL, telefone_e164 = NULL, anonimizada_em = now() WHERE id = $1', [anonima.clienteId]);

    const deOutro = await criarAvaliavel(c, outro);
    const tOutro = (await emitirLink(outro, deOutro.reservaId)).token;

    const valido = await criarAvaliavel(c, s);
    const tValido = (await emitirLink(s, valido.reservaId)).token;
    const alterado = (tValido[0] === 'A' ? 'B' : 'A') + tValido.slice(1);
    const desconhecido = gerarToken(SEGREDO_TESTE, s.salaoId, '00000000-0000-4000-8000-000000000001');

    return [
      { nome: 'já usado', slug: s.slugAtual, token: tUsada, agora: AGORA },
      { nome: 'vencido (agora = expira_em, fronteira <)', slug: s.slugAtual, token: tVencida, agora: new Date(AGORA.getTime() + 30 * DIA_MS) },
      { nome: 'reserva nao_compareceu', slug: s.slugAtual, token: tNaoConcluida, agora: AGORA },
      { nome: 'invalidado', slug: s.slugAtual, token: tInvalidada, agora: AGORA },
      { nome: 'cliente anonimizada', slug: s.slugAtual, token: tAnonima, agora: AGORA },
      { nome: 'token de outro salão em /s1', slug: s.slugAtual, token: tOutro, agora: AGORA },
      { nome: 'token alterado', slug: s.slugAtual, token: alterado, agora: AGORA },
      { nome: 'desconhecido', slug: s.slugAtual, token: desconhecido, agora: AGORA },
      { nome: 'malformado', slug: s.slugAtual, token: 'curto', agora: AGORA },
      { nome: 'slug inexistente', slug: 'nao-existe-mesmo', token: tValido, agora: AGORA },
      { nome: 'slug implausível', slug: '../x', token: tValido, agora: AGORA },
    ];
  }

  it('GET e POST respondem o mesmo para todos os casos e o banco não muda', async () => {
    const lista = await casos();
    const antes = [await fotografia(c, s.salaoId), await fotografia(c, outro.salaoId)];
    for (const k of lista) {
      expect(await verificarLink(k.slug, k.token, ipNovo(), k.agora), `GET ${k.nome}`).toEqual({ ok: false, motivo: 'invalido' });
      expect(await enviar({ slugAtual: k.slug }, k.token, {}, k.agora), `POST ${k.nome}`).toEqual({ resultado: 'link_invalido' });
      // Mesmo com campos inválidos, link inválido tem prioridade (não vira oráculo).
      expect(await enviar({ slugAtual: k.slug }, k.token, { nota: '9', aceite: null }, k.agora), `POST campos ${k.nome}`).toEqual({ resultado: 'link_invalido' });
    }
    expect([await fotografia(c, s.salaoId), await fotografia(c, outro.salaoId)]).toEqual(antes);
  });

  it('a fronteira do prazo: 1 ms antes do vencimento ainda vale', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId);
    const quase = new Date(AGORA.getTime() + 30 * DIA_MS - 1);
    expect(await verificarLink(s.slugAtual, token, ipNovo(), quase)).toMatchObject({ ok: true });
    expect(await enviar(s, token, {}, quase)).toEqual({ resultado: 'enviada' });
  });

  it('segunda submissão do mesmo link: recusada, ainda uma avaliação', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId);
    expect(await enviar(s, token)).toEqual({ resultado: 'enviada' });
    expect(await enviar(s, token, { nota: '1' })).toEqual({ resultado: 'link_invalido' });
    const { rows } = await c.query('SELECT nota FROM avaliacao WHERE reserva_id = $1', [k.reservaId]);
    expect(rows).toEqual([{ nota: 4 }]);
  });
});

describe('CA-6: campos inválidos', () => {
  it.each([
    ['nota 0', { nota: '0' }, 'nota'],
    ['nota 6', { nota: '6' }, 'nota'],
    ['nota 3.5', { nota: '3.5' }, 'nota'],
    ['sem nota', { nota: undefined }, 'nota'],
    ['comentário > 1000', { comentario: 'x'.repeat(1001) }, 'comentario'],
    ['sem aceite', { aceite: null }, 'aceite'],
    ['aceite "false"', { aceite: 'false' }, 'aceite'],
  ] as const)('%s: erro de campo em pt-BR, nada gravado e o link segue válido', async (_n, sobre, campo) => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId);
    const antes = await fotografia(c, s.salaoId);
    const r = await enviar(s, token, sobre as never);
    expect(r).toMatchObject({ resultado: 'invalido_campos' });
    expect((r as { erros: Record<string, string> }).erros[campo]).toMatch(/\S/);
    expect(await fotografia(c, s.salaoId)).toBe(antes);
    expect(await enviar(s, token)).toEqual({ resultado: 'enviada' });
  });

  it('comentário de exatamente 1000 caracteres é aceito', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId);
    expect(await enviar(s, token, { comentario: 'é'.repeat(1000) })).toEqual({ resultado: 'enviada' });
  });
});

describe('CA-9: salão suspenso lê e envia', () => {
  it('assinatura suspensa não impede o envio nem a leitura', async () => {
    const sus = await salaoNovo();
    await c.query("INSERT INTO assinatura (salao_id, estado) VALUES ($1, 'suspensa')", [sus.salaoId]);
    await c.query('UPDATE salao SET suspenso_manual_em = now() WHERE id = $1', [sus.salaoId]);
    const k = await criarAvaliavel(c, sus);
    const { token } = await emitirLink(sus, k.reservaId);
    expect(await verificarLink(sus.slugAtual, token, ipNovo(), AGORA)).toMatchObject({ ok: true });
    expect(await enviar(sus, token)).toEqual({ resultado: 'enviada' });
    expect((await lerAvaliacoesPublicas(ctxPublico(sus))).total).toBe(1);
  });
});

describe('CA-12: limite por IP', () => {
  it('excedido: limite_excedido sem consultar o token; escopo reserva não é afetado', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId);
    const ip = ipNovo();
    const config = { ...configDaProtecao(), limiteIp: { ...configDaProtecao().limiteIp, avaliacao: 2 } };
    const limitar = (i: string, e: Parameters<typeof limitarPorIp>[1], a: Date) => limitarPorIp(i, e, a, { config });
    const deps = { limitarPorIp: limitar };
    // 1ª e 2ª passam (a 2ª consome o link); a 3ª é barrada antes de qualquer leitura do token.
    expect(await enviar(s, token, { ip }, AGORA, deps)).toEqual({ resultado: 'enviada' });
    expect(await verificarLink(s.slugAtual, token, ip, AGORA, deps)).toMatchObject({ ok: false, motivo: 'invalido' });
    expect(await verificarLink(s.slugAtual, token, ip, AGORA, deps)).toEqual({ ok: false, motivo: 'limite' });
    expect(await enviar(s, token, { ip }, AGORA, deps)).toEqual({ resultado: 'limite_excedido' });
    expect(await limitarPorIp(ip, 'reserva', AGORA, { config })).toEqual({ permitido: true });
  });

  it('o limite barra um link VÁLIDO sem consumi-lo', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId);
    const bloqueado = { limitarPorIp: async () => ({ permitido: false as const, reiniciaEm: AGORA }) };
    expect(await enviar(s, token, {}, AGORA, bloqueado)).toEqual({ resultado: 'limite_excedido' });
    expect((await conviteDe(c, k.reservaId))?.usado_em).toBeNull();
  });
});

describe('CA-13: verificação humana', () => {
  it('Turnstile recusa: nada gravado e o link não é consumido', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId);
    expect(await enviar(s, token, { tokenHumano: TOKEN_INVALIDO_DE_TESTE })).toEqual({ resultado: 'verificacao_falhou' });
    expect(await enviar(s, token, { tokenHumano: null })).toEqual({ resultado: 'verificacao_falhou' });
    expect((await conviteDe(c, k.reservaId))?.usado_em).toBeNull();
    expect((await c.query('SELECT 1 FROM avaliacao WHERE reserva_id = $1', [k.reservaId])).rowCount).toBe(0);
    expect(await enviar(s, token)).toEqual({ resultado: 'enviada' });
    expect(MENSAGENS_AVALIACAO.humano).toMatch(/pessoa/);
  });
});

describe('CA-14: texto cru', () => {
  it('HTML no comentário é gravado e lido como texto (o componente escapa)', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId);
    const html = '<script>alert(1)</script> <b>negrito</b>';
    await enviar(s, token, { comentario: html });
    const pub = await lerAvaliacoesPublicas(ctxPublico(s), 100);
    expect(pub.itens.some((i) => i.comentario === html)).toBe(true);
  });
});
