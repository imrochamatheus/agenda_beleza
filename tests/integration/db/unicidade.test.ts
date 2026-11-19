import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  conectar,
  criarCenario,
  criarSalao,
  emailNovo,
  erroSql,
  inserirReserva,
  slugNovo,
} from '../../support/sql';

// CA-11 (RN-9), CA-17 (RN-8) e CA-18 (RN-12).
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

async function contar(sql: string, params: unknown[]): Promise<number> {
  const r = await c.query<{ n: number }>(sql, params);
  return r.rows[0].n;
}

function inserirSlug(salaoId: string, slug: string, atual: boolean) {
  return c.query('INSERT INTO salao_slug (slug, salao_id, atual) VALUES ($1, $2, $3)', [slug, salaoId, atual]);
}

describe('salao_slug (CA-11)', () => {
  it('CA-11: slug atual de um salão é rejeitado para outro salão (23505)', async () => {
    const s1 = await criarSalao(c);
    const s2 = await criarSalao(c);
    const slug = slugNovo();
    await inserirSlug(s1, slug, true);
    const erro = await erroSql(inserirSlug(s2, slug, true));
    expect(erro).toEqual({ code: '23505', constraint: 'salao_slug_pkey' });
    expect(await contar('SELECT count(*)::int AS n FROM salao_slug WHERE salao_id = $1', [s2])).toBe(0);
  });

  it('CA-11: slug histórico de um salão é rejeitado para outro salão (23505)', async () => {
    const s1 = await criarSalao(c);
    const s2 = await criarSalao(c);
    const historico = slugNovo();
    await inserirSlug(s1, historico, false);
    await inserirSlug(s1, slugNovo(), true);
    const erro = await erroSql(inserirSlug(s2, historico, true));
    expect(erro).toEqual({ code: '23505', constraint: 'salao_slug_pkey' });
  });

  it('CA-11: um salão com dois slugs atuais é rejeitado (23505); atual + histórico é aceito', async () => {
    const s = await criarSalao(c);
    await inserirSlug(s, slugNovo(), true);
    await inserirSlug(s, slugNovo(), false);
    const erro = await erroSql(inserirSlug(s, slugNovo(), true));
    expect(erro).toEqual({ code: '23505', constraint: 'salao_slug_atual_uniq' });
    expect(await contar('SELECT count(*)::int AS n FROM salao_slug WHERE salao_id = $1 AND atual', [s])).toBe(1);
  });

  it.each(['Salao', '-a', 'a--b', 'a-', 'salão', 'a b'])(
    'CA-11 (RN-9): slug fora do padrão "%s" é rejeitado pelo CHECK (23514)',
    async (slug) => {
      const s = await criarSalao(c);
      const erro = await erroSql(inserirSlug(s, slug, true));
      expect(erro).toEqual({ code: '23514', constraint: 'salao_slug_formato_chk' });
    },
  );
});

describe('idempotência e vigência (CA-17)', () => {
  async function reservaNova(): Promise<{ salaoId: string; reservaId: string }> {
    const s = await criarCenario(c);
    const reservaId = await inserirReserva(c, { ...s, inicio: '2026-12-01T10:00:00Z', fim: '2026-12-01T11:00:00Z' });
    return { salaoId: s.salaoId, reservaId };
  }

  function inserirMensagem(salaoId: string, reservaId: string, revisao: number) {
    return c.query(
      "INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao) VALUES ($1, $2, 'confirmacao', $3)",
      [salaoId, reservaId, revisao],
    );
  }

  it('CA-17a: mensagem com mesmos reserva_id, tipo e revisao é rejeitada; com revisao diferente é aceita', async () => {
    const { salaoId, reservaId } = await reservaNova();
    await inserirMensagem(salaoId, reservaId, 0);
    const erro = await erroSql(inserirMensagem(salaoId, reservaId, 0));
    expect(erro).toEqual({ code: '23505', constraint: 'mensagem_reserva_id_tipo_revisao_key' });
    await inserirMensagem(salaoId, reservaId, 1);
    expect(await contar('SELECT count(*)::int AS n FROM mensagem WHERE reserva_id = $1', [reservaId])).toBe(2);
  });

  function inserirWebhook(chave: string, origemValida: boolean) {
    return c.query(
      "INSERT INTO webhook_evento (provedor, chave_dedupe, payload, origem_valida) VALUES ('mercado_pago', $1, '{}'::jsonb, $2)",
      [chave, origemValida],
    );
  }

  it('CA-17b: webhook com mesmos provedor e chave_dedupe e origem válida nos dois é rejeitado', async () => {
    const chave = randomUUID();
    await inserirWebhook(chave, true);
    const erro = await erroSql(inserirWebhook(chave, true));
    expect(erro).toEqual({ code: '23505', constraint: 'webhook_evento_dedupe_uniq' });
    expect(await contar('SELECT count(*)::int AS n FROM webhook_evento WHERE chave_dedupe = $1', [chave])).toBe(1);
  });

  it('CA-17b: com o primeiro de origem inválida, os dois são aceitos', async () => {
    const chave = randomUUID();
    await inserirWebhook(chave, false);
    await inserirWebhook(chave, true);
    expect(await contar('SELECT count(*)::int AS n FROM webhook_evento WHERE chave_dedupe = $1', [chave])).toBe(2);
  });

  async function assinaturaNova(salaoId: string, estado = 'pendente'): Promise<string> {
    const r = await c.query<{ id: string }>(
      'INSERT INTO assinatura (salao_id, estado) VALUES ($1, $2::estado_assinatura) RETURNING id',
      [salaoId, estado],
    );
    return r.rows[0].id;
  }

  it('CA-17c: assinatura_pagamento com o mesmo pagamento_id é rejeitado', async () => {
    const assinaturaId = await assinaturaNova(await criarSalao(c));
    const pagamentoId = randomUUID();
    const inserir = () =>
      c.query(
        "INSERT INTO assinatura_pagamento (assinatura_id, pagamento_id, status, valor_centavos) VALUES ($1, $2, 'approved', 7900)",
        [assinaturaId, pagamentoId],
      );
    await inserir();
    const erro = await erroSql(inserir());
    expect(erro).toEqual({ code: '23505', constraint: 'assinatura_pagamento_pagamento_id_key' });
  });

  it('CA-17d: segunda assinatura não encerrada do mesmo salão é rejeitada', async () => {
    const s = await criarSalao(c);
    await assinaturaNova(s, 'ativa');
    const erro = await erroSql(assinaturaNova(s, 'pendente'));
    expect(erro).toEqual({ code: '23505', constraint: 'assinatura_vigente_por_salao_uniq' });
    expect(await contar('SELECT count(*)::int AS n FROM assinatura WHERE salao_id = $1', [s])).toBe(1);
  });

  it('CA-17d: com a primeira encerrada, a segunda é aceita', async () => {
    const s = await criarSalao(c);
    await assinaturaNova(s, 'encerrada');
    await assinaturaNova(s, 'pendente');
    expect(await contar('SELECT count(*)::int AS n FROM assinatura WHERE salao_id = $1', [s])).toBe(2);
  });

  it('CA-17e: reserva com mesmos salao_id e chave_requisicao é rejeitada; duas com chave nula são aceitas', async () => {
    const s = await criarCenario(c);
    const chave = randomUUID();
    await inserirReserva(c, { ...s, inicio: '2026-12-01T10:00:00Z', fim: '2026-12-01T11:00:00Z', chaveRequisicao: chave });
    // Horário diferente: a rejeição tem de vir da unicidade, não da exclusion.
    const erro = await erroSql(
      inserirReserva(c, { ...s, inicio: '2026-12-01T14:00:00Z', fim: '2026-12-01T15:00:00Z', chaveRequisicao: chave }),
    );
    expect(erro).toEqual({ code: '23505', constraint: 'reserva_salao_id_chave_requisicao_key' });

    await inserirReserva(c, { ...s, inicio: '2026-12-02T10:00:00Z', fim: '2026-12-02T11:00:00Z' });
    await inserirReserva(c, { ...s, inicio: '2026-12-03T10:00:00Z', fim: '2026-12-03T11:00:00Z' });
    expect(
      await contar('SELECT count(*)::int AS n FROM reserva WHERE salao_id = $1 AND chave_requisicao IS NULL', [s.salaoId]),
    ).toBe(2);
  });
});

describe('usuario (CA-18, RN-12)', () => {
  function inserirUsuario(salaoId: string | null, papel: string, email = emailNovo()) {
    return c.query<{ id: string }>(
      "INSERT INTO usuario (salao_id, papel, email, nome, senha_hash) VALUES ($1, $2::papel_usuario, $3, 'Usuária', 'hash') RETURNING id",
      [salaoId, papel, email],
    );
  }

  it('CA-18: segundo gestor no mesmo salão é rejeitado (23505); profissional no mesmo salão é aceito', async () => {
    const s = await criarSalao(c);
    await inserirUsuario(s, 'gestor');
    const erro = await erroSql(inserirUsuario(s, 'gestor'));
    expect(erro).toEqual({ code: '23505', constraint: 'usuario_gestor_por_salao_uniq' });
    await inserirUsuario(s, 'profissional');
    expect(await contar('SELECT count(*)::int AS n FROM usuario WHERE salao_id = $1', [s])).toBe(2);
  });

  it('CA-18: e-mail com maiúscula é rejeitado (23514)', async () => {
    const s = await criarSalao(c);
    const erro = await erroSql(inserirUsuario(s, 'gestor', `Ana-${randomUUID()}@exemplo.com.br`));
    expect(erro).toEqual({ code: '23514', constraint: 'usuario_email_minusculo_chk' });
  });

  it('CA-18 (RN-12): e-mail repetido é rejeitado (23505)', async () => {
    const email = emailNovo();
    await inserirUsuario(await criarSalao(c), 'gestor', email);
    const erro = await erroSql(inserirUsuario(await criarSalao(c), 'gestor', email));
    expect(erro).toEqual({ code: '23505', constraint: 'usuario_email_key' });
  });

  it('CA-18: super_admin com salao_id é rejeitado (23514)', async () => {
    const s = await criarSalao(c);
    const erro = await erroSql(inserirUsuario(s, 'super_admin'));
    expect(erro).toEqual({ code: '23514', constraint: 'usuario_papel_salao_chk' });
  });

  it.each(['gestor', 'profissional'])('CA-18: %s sem salao_id é rejeitado (23514)', async (papel) => {
    const erro = await erroSql(inserirUsuario(null, papel));
    expect(erro).toEqual({ code: '23514', constraint: 'usuario_papel_salao_chk' });
  });

  it('CA-18 (controle): super_admin sem salao_id é aceito', async () => {
    const email = emailNovo();
    await inserirUsuario(null, 'super_admin', email);
    expect(await contar('SELECT count(*)::int AS n FROM usuario WHERE email = $1 AND salao_id IS NULL', [email])).toBe(1);
  });

  it('CA-18 (RN-12): um usuário não se vincula a dois profissionais (23505)', async () => {
    const s = await criarSalao(c);
    const u = (await inserirUsuario(s, 'profissional')).rows[0].id;
    const inserir = () =>
      c.query("INSERT INTO profissional (salao_id, usuario_id, nome) VALUES ($1, $2, 'Bia')", [s, u]);
    await inserir();
    const erro = await erroSql(inserir());
    expect(erro).toEqual({ code: '23505', constraint: 'profissional_salao_id_usuario_id_key' });
  });
});
