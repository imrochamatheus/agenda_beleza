import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { lerAvaliacoesPublicas } from '@/server/avaliacoes/leitura';
import { verificarLink } from '@/server/avaliacoes/servico';

import type { SalaoCompleto } from '../../support/factories';
import { ipNovo } from '../../support/reserva-publica';
import { conectar } from '../../support/sql';

import { AGORA, DIA_MS, criarAvaliavel, ctxPublico, definirStatus, emitirLink, enviar, fotografia, salaoNovo } from './apoio';

// Verificação independente do tester (D-032): uniformidade, concorrência simples e leitura pública.
let c: pg.Client;
let s: SalaoCompleto;
let o: SalaoCompleto;
beforeAll(async () => {
  c = await conectar();
  s = await salaoNovo();
  o = await salaoNovo();
});
afterAll(async () => c.end());
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('uniformidade e leitura', () => {
  it('todas as recusas são idênticas e nada é gravado', async () => {
    const respostas: unknown[] = [];
    const ok = await criarAvaliavel(c, s);
    const usado = await criarAvaliavel(c, s);
    const nc = await criarAvaliavel(c, s);
    const anon = await criarAvaliavel(c, s);
    const venc = await criarAvaliavel(c, s);
    const outroSalao = await criarAvaliavel(c, o);
    const tOk = (await emitirLink(s, ok.reservaId)).token;
    const tUsado = (await emitirLink(s, usado.reservaId)).token;
    const tNc = (await emitirLink(s, nc.reservaId)).token;
    const tAnon = (await emitirLink(s, anon.reservaId)).token;
    const tVenc = (await emitirLink(s, venc.reservaId)).token;
    const tOutro = (await emitirLink(o, outroSalao.reservaId)).token;
    expect(await enviar(s, tUsado)).toEqual({ resultado: 'enviada' });
    await definirStatus(c, nc.reservaId, 'nao_compareceu');
    await c.query("UPDATE cliente SET anonimizada_em=now(), nome=NULL, telefone_e164=NULL WHERE id=$1", [anon.clienteId]);
    const antes = await fotografia(c, s.salaoId);
    const depoisDe30 = new Date(AGORA.getTime() + 30 * DIA_MS);
    for (const t of [tUsado, tNc, tAnon, tOutro, 'x'.repeat(43), 'curto', tOk.slice(0, 42) + (tOk.endsWith('A') ? 'B' : 'A')]) {
      respostas.push(await enviar(s, t));
    }
    respostas.push(await enviar(s, tVenc, {}, depoisDe30));
    expect(new Set(respostas.map((r) => JSON.stringify(r)))).toEqual(new Set([JSON.stringify({ resultado: 'link_invalido' })]));
    expect(await fotografia(c, s.salaoId)).toBe(antes);
    // GET
    for (const t of [tUsado, tNc, tAnon, tOutro]) {
      expect(await verificarLink(s.slugAtual, t, ipNovo(), AGORA)).toEqual({ ok: false, motivo: 'invalido' });
    }
    expect((await verificarLink(s.slugAtual, tVenc, ipNovo(), depoisDe30)).ok).toBe(false);
    expect((await verificarLink(s.slugAtual, tOk, ipNovo(), new Date(depoisDe30.getTime() - 1))).ok).toBe(true);
  });

  it('16 envios simultâneos do mesmo link = 1 avaliação', async () => {
    const k = await criarAvaliavel(c, s);
    const { token } = await emitirLink(s, k.reservaId);
    const r = await Promise.all(Array.from({ length: 16 }, () => enviar(s, token)));
    expect(r.filter((x) => x.resultado === 'enviada')).toHaveLength(1);
    expect(r.filter((x) => x.resultado === 'link_invalido')).toHaveLength(15);
    const { rows } = await c.query('SELECT count(*)::int n FROM avaliacao WHERE reserva_id=$1', [k.reservaId]);
    expect(rows[0].n).toBe(1);
  });

  it('média/contagem só das visíveis, isolada por salão, XSS cru', async () => {
    const t = await salaoNovo();
    const a = await criarAvaliavel(c, t, { nome: 'Ana Maria Lima' });
    const b = await criarAvaliavel(c, t);
    const d = await criarAvaliavel(c, t);
    const e = await criarAvaliavel(c, t);
    const tk = async (k: { reservaId: string }, nota: string, com = '') => enviar(t, (await emitirLink(t, k.reservaId)).token, { nota, comentario: com });
    await tk(a, '5', '<script>alert(1)</script>');
    await tk(b, '4');
    await tk(d, '1');
    await tk(e, '2');
    await c.query("UPDATE avaliacao SET retirada_em=now() WHERE reserva_id=$1", [d.reservaId]);
    await definirStatus(c, e.reservaId, 'nao_compareceu');
    const p = await lerAvaliacoesPublicas(ctxPublico(t));
    expect(p.total).toBe(2);
    expect(p.media).toBe(4.5);
    expect(p.itens.find((i) => i.nome === 'Ana L.')?.comentario).toBe('<script>alert(1)</script>');
    const q = await lerAvaliacoesPublicas(ctxPublico(o));
    expect(JSON.stringify(q)).not.toContain('Ana L.');
  });
});
