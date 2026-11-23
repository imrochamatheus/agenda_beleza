import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { garantirSuperAdmin } from '@/server/auth/admin/garantir-super-admin';
import { servirFoto } from '@/server/fotos/entrega';
import { integracoes } from '@/server/integrations/registry';
import { repos } from '@/server/repos';
import { defineAcao } from '@/server/tenant/define-acao';
import { normalizarTelefoneBr } from '@/lib/telefone';

import { CREDENCIAIS_DEMO, semear } from '../../../prisma/seed';
import { entrarDeVerdade } from '../../support/auth';
import { conferirDerivados } from '../../support/reservas';
import { conectar, erroSql } from '../../support/sql';

import { prepararArmazenamento, TABELAS_SEMEADAS } from './apoio';

// D-036 CA-1, CA-2, CA-3, CA-5, CA-6 e CA-7: o seed contra o PostgreSQL real. A primeira execução são
// duas em paralelo (a corrida não duplica); depois, uma terceira em série.

let c: pg.Client;
let arm: ReturnType<typeof prepararArmazenamento>;
let contagens: Record<string, number>;
let ids: string[];

async function contar(): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  for (const t of TABELAS_SEMEADAS) r[t] = Number((await c.query(`SELECT count(*) FROM ${t}`)).rows[0].count);
  return r;
}
async function idsPorTabela(): Promise<string[]> {
  const partes = TABELAS_SEMEADAS.filter((t) => t !== 'servico_profissional').map(
    (t) => `SELECT '${t}:' || ${t === 'salao_slug' ? 'slug' : 'id'} AS k FROM ${t}`,
  );
  return (await c.query(`${partes.join(' UNION ALL ')} ORDER BY 1`)).rows.map((x) => x.k as string);
}

beforeAll(async () => {
  c = await conectar();
  arm = prepararArmazenamento();
  // Ambiente isolado: o par SUPERADMIN_* do `.env` de quem segue o README não pode mudar o super admin de demonstração.
  const deps = { armazenamento: integracoes().armazenamento, env: { ...process.env, SUPERADMIN_EMAIL: undefined, SUPERADMIN_PASSWORD: undefined } };
  await Promise.all([semear(deps), semear(deps)]);
  contagens = await contar();
  ids = await idsPorTabela();
}, 120_000);
afterAll(async () => {
  arm.encerrar();
  await c.end();
});

describe('CA-1: conteúdo', () => {
  it('2 salões, cada um com 1 gestor confirmado, ≥ 2 profissionais, ≥ 3 serviços e reservas; 1 super admin', async () => {
    expect(contagens.salao).toBe(2);
    const salao = (
      await c.query(`
        SELECT s.id, s.fuso,
          (SELECT count(*) FROM usuario u WHERE u.salao_id = s.id AND u.papel = 'gestor' AND u.email_confirmado_em IS NOT NULL)::int AS gestores,
          (SELECT count(*) FROM profissional p WHERE p.salao_id = s.id AND p.ativo)::int AS profissionais,
          (SELECT count(*) FROM servico v WHERE v.salao_id = s.id AND v.ativo)::int AS servicos,
          (SELECT count(*) FROM reserva r WHERE r.salao_id = s.id)::int AS reservas
        FROM salao s ORDER BY s.nome`)
    ).rows;
    expect(salao.map((s) => s.fuso)).toEqual(['America/Manaus', 'America/Sao_Paulo']);
    for (const s of salao) {
      expect(s.gestores).toBe(1);
      expect(s.profissionais).toBeGreaterThanOrEqual(2);
      expect(s.servicos).toBeGreaterThanOrEqual(3);
      expect(s.reservas).toBeGreaterThan(0);
    }
    const status = (await c.query('SELECT DISTINCT status::text FROM reserva ORDER BY 1')).rows.map((r) => r.status);
    expect(status).toEqual(['cancelado', 'concluido', 'confirmado', 'nao_compareceu']);
    expect((await c.query(`SELECT count(*)::int AS n FROM usuario WHERE papel = 'super_admin'`)).rows[0].n).toBe(1);
  });

  it('a gestora do salão A atende (perfil de profissional vinculado); o gestor de B não', async () => {
    const r = await c.query(
      `SELECT u.email, count(p.id)::int AS perfis FROM usuario u LEFT JOIN profissional p ON p.usuario_id = u.id WHERE u.papel = 'gestor' GROUP BY u.email ORDER BY u.email`,
    );
    expect(r.rows).toEqual([
      { email: CREDENCIAIS_DEMO.gestorA.email, perfis: 1 },
      { email: CREDENCIAIS_DEMO.gestorB.email, perfis: 0 },
    ]);
  });

  it('vínculos parciais: nenhum profissional faz todos os pares de serviços; há quem faça todos', async () => {
    const r = await c.query(`
      SELECT p.nome, count(sp.servico_id)::int AS n, (SELECT count(*)::int FROM servico v WHERE v.salao_id = p.salao_id) AS total
        FROM profissional p JOIN servico_profissional sp ON sp.profissional_id = p.id GROUP BY p.id ORDER BY p.nome`);
    expect(r.rows.some((x) => x.n === x.total)).toBe(true);
    expect(r.rows.some((x) => x.n < x.total)).toBe(true);
  });
});

describe('CA-2: idempotência', () => {
  it('uma terceira execução não muda contagens nem ids', async () => {
    await semear({ armazenamento: integracoes().armazenamento, env: { ...process.env, SUPERADMIN_EMAIL: undefined, SUPERADMIN_PASSWORD: undefined } });
    expect(await contar()).toEqual(contagens);
    expect(await idsPorTabela()).toEqual(ids);
  });

  it('nada é apagado nem alterado: um dado editado depois do seed sobrevive a nova execução', async () => {
    await c.query(`UPDATE servico SET nome = 'Corte editado' WHERE nome = 'Corte feminino'`);
    await semear({ armazenamento: integracoes().armazenamento, env: { ...process.env, SUPERADMIN_EMAIL: undefined, SUPERADMIN_PASSWORD: undefined } });
    expect((await c.query(`SELECT count(*)::int AS n FROM servico WHERE nome = 'Corte editado'`)).rows[0].n).toBe(1);
    await c.query(`UPDATE servico SET nome = 'Corte feminino' WHERE nome = 'Corte editado'`);
  });
});

describe('CA-3: cada gestor vê só o próprio salão', () => {
  it.each([
    ['A', CREDENCIAIS_DEMO.gestorA.email, 'Corte feminino', 'Barba'],
    ['B', CREDENCIAIS_DEMO.gestorB.email, 'Barba', 'Corte feminino'],
  ])('login real do gestor de %s', async (_n, email, proprio, alheio) => {
    const { credencial } = await entrarDeVerdade(email, { senha: CREDENCIAIS_DEMO.senha });
    const listar = defineAcao({ papeis: ['gestor'], capacidade: 'leitura' }, (ctx) => repos().servicos.listar(ctx));
    const r = await listar.executar(credencial, undefined);
    if (!r.ok) throw new Error('ação recusada');
    const nomes = r.dados.map((s) => s.nome);
    expect(nomes).toContain(proprio);
    expect(nomes).not.toContain(alheio);
  });
});

describe('CA-5: perfil, funcionamento, fotos e avaliações', () => {
  it('perfil completo, funcionamento definido e avaliações publicadas de reservas concluídas', async () => {
    const r = await c.query(`
      SELECT s.nome, s.descricao IS NOT NULL AND s.endereco_cep IS NOT NULL AND s.telefone_e164 IS NOT NULL AND s.instagram IS NOT NULL
               AND cardinality(s.meios_pagamento) > 0 AND cardinality(s.comodidades) > 0 AS perfil,
        s.funcionamento_definido AS definido,
        (SELECT count(*)::int FROM salao_funcionamento f WHERE f.salao_id = s.id) AS faixas,
        (SELECT count(*)::int FROM avaliacao a JOIN reserva r ON r.id = a.reserva_id
          WHERE a.salao_id = s.id AND a.retirada_em IS NULL AND r.status = 'concluido' AND a.criado_em > r.fim) AS avaliacoes
        FROM salao s ORDER BY s.nome`);
    expect(r.rows).toHaveLength(2);
    for (const s of r.rows) {
      expect(s.perfil).toBe(true);
      expect(s.definido).toBe(true);
      expect(s.faixas).toBeGreaterThan(0);
      expect(s.avaliacoes).toBeGreaterThanOrEqual(2);
    }
  });

  it('≥ 2 fotos por salão: o objeto existe no armazenamento e a entrega responde 200 image/webp', async () => {
    const fotos = (await c.query('SELECT id, chave, salao_id FROM salao_foto ORDER BY salao_id, posicao')).rows;
    const porSalao = new Map<string, number>();
    for (const f of fotos) {
      porSalao.set(f.salao_id, (porSalao.get(f.salao_id) ?? 0) + 1);
      const bytes = await integracoes().armazenamento.ler(f.chave);
      expect(bytes).not.toBeNull();
      expect(Buffer.from(bytes!).subarray(8, 12).toString()).toBe('WEBP');
      const resposta = await servirFoto(f.id, new Request(`http://localhost:3000/api/fotos/${f.id}`));
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get('content-type')).toBe('image/webp');
    }
    expect([...porSalao.values()].every((n) => n >= 2)).toBe(true);
    expect(porSalao.size).toBe(2);
  });

  it('inclui uma cliente anonimizada com reserva e avaliação sem nome nem comentário', async () => {
    const r = await c.query(`
      SELECT a.nome_exibicao, a.comentario FROM avaliacao a JOIN cliente cl ON cl.id = a.cliente_id WHERE cl.anonimizada_em IS NOT NULL`);
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
    for (const a of r.rows) expect(a).toEqual({ nome_exibicao: null, comentario: null });
  });
});

describe('CA-6: assinaturas e super admin', () => {
  it('A em teste por DIAS_TESTE dias; B ativa', async () => {
    const r = await c.query(`
      SELECT s.nome, a.estado::text AS estado, a.teste_fim_em, a.periodo_pago_ate, a.criado_em
        FROM assinatura a JOIN salao s ON s.id = a.salao_id ORDER BY s.nome`);
    expect(r.rows.map((x) => [x.nome, x.estado])).toEqual([['Ateliê Bromélia', 'ativa'], ['Studio Aurora', 'em_teste']]);
    const teste = r.rows[1];
    expect(Math.round((teste.teste_fim_em.getTime() - teste.criado_em.getTime()) / 86_400_000)).toBe(30);
    expect(r.rows[0].periodo_pago_ate).not.toBeNull();
  });

  it('o super admin existe sem TOTP; garantirSuperAdmin de novo devolve existente e não muda o hash', async () => {
    const antes = (await c.query(`SELECT senha_hash, totp_segredo_cifrado, totp_ativado_em FROM usuario WHERE email = $1`, [CREDENCIAIS_DEMO.admin.email])).rows[0];
    expect(antes.totp_segredo_cifrado).toBeNull();
    expect(antes.totp_ativado_em).toBeNull();
    expect(await garantirSuperAdmin({ email: CREDENCIAIS_DEMO.admin.email, senha: 'Outra senha 12345' })).toBe('existente');
    const depois = (await c.query(`SELECT senha_hash FROM usuario WHERE email = $1`, [CREDENCIAIS_DEMO.admin.email])).rows[0];
    expect(depois.senha_hash).toBe(antes.senha_hash);
  });
});

describe('CA-7: telefones válidos e exclusão de sobreposição', () => {
  it('todo telefone de cliente é E.164 normalizado; as anonimizadas não têm telefone', async () => {
    const r = await c.query('SELECT telefone_e164 AS t, anonimizada_em FROM cliente');
    for (const x of r.rows) {
      if (x.anonimizada_em === null) expect(normalizarTelefoneBr(x.t)).toBe(x.t);
      else expect(x.t).toBeNull();
    }
  });

  it('nenhum item ocupante se sobrepõe a outro do mesmo profissional, e a constraint rejeita um novo', async () => {
    const pares = await c.query(`
      SELECT 1 FROM reserva_item a JOIN reserva_item b ON a.profissional_id = b.profissional_id AND a.id < b.id
       WHERE a.status IN ('confirmado','concluido','nao_compareceu') AND b.status IN ('confirmado','concluido','nao_compareceu')
         AND tstzrange(a.inicio, a.ocupado_ate, '[)') && tstzrange(b.inicio, b.ocupado_ate, '[)')`);
    expect(pares.rowCount).toBe(0);
    const base = (
      await c.query(`
        SELECT i.salao_id, i.profissional_id, i.servico_id, i.inicio, i.fim, i.ocupado_ate, i.duracao_min, r.cliente_id
          FROM reserva_item i JOIN reserva r ON r.id = i.reserva_id WHERE i.status = 'confirmado' LIMIT 1`)
    ).rows[0];
    // Uma reserva nova, de outra cliente, no mesmo horário do mesmo profissional (num só comando).
    const erro = await erroSql(
      c.query(
        `WITH r AS (
           INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem)
           VALUES ($1, $3, $5, $6, 'confirmado', 'equipe') RETURNING id
         )
         INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, inicio, fim, ocupado_ate, status, preco_centavos, duracao_min)
         SELECT $1, r.id, $4, $2, 0, $5, $6, $7, 'confirmado', 0, $8 FROM r`,
        [base.salao_id, base.profissional_id, base.cliente_id, base.servico_id, base.inicio, base.fim, base.ocupado_ate, base.duracao_min],
      ),
    );
    expect(erro).toEqual({ code: '23P01', constraint: 'reserva_item_sem_sobreposicao' });
  });
});

describe('D-050: itens e derivados', () => {
  it('toda reserva semeada tem itens e derivados (status, início, fim, cancelada_em) coerentes com eles', async () => {
    const saloes = (await c.query('SELECT id FROM salao ORDER BY id')).rows;
    let total = 0;
    for (const s of saloes) total += await conferirDerivados({ salaoId: s.id });
    expect(total).toBe(contagens.reserva);
  });

  it('CA-51: no salão A há uma reserva com 3 itens em 3 profissionais, de manhã e à tarde, no mesmo dia', async () => {
    const r = await c.query(`
      SELECT r.id, r.status::text AS status, count(*)::int AS itens, count(DISTINCT i.profissional_id)::int AS profissionais,
             bool_or(extract(hour FROM i.inicio AT TIME ZONE s.fuso) < 12) AS manha,
             bool_or(extract(hour FROM i.inicio AT TIME ZONE s.fuso) >= 12) AS tarde,
             count(DISTINCT (i.inicio AT TIME ZONE s.fuso)::date)::int AS dias,
             string_agg(v.nome || ' com ' || p.nome, '; ' ORDER BY i.inicio) AS roteiro
        FROM reserva r
        JOIN salao s ON s.id = r.salao_id
        JOIN reserva_item i ON i.salao_id = r.salao_id AND i.reserva_id = r.id
        JOIN servico v ON v.salao_id = i.salao_id AND v.id = i.servico_id
        JOIN profissional p ON p.salao_id = i.salao_id AND p.id = i.profissional_id
       WHERE s.nome = 'Studio Aurora'
       GROUP BY r.id
      HAVING count(DISTINCT i.profissional_id) >= 3`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ status: 'confirmado', itens: 3, profissionais: 3, manha: true, tarde: true, dias: 1 });
    expect(r.rows[0].roteiro).toBe('Escova com Marcos Pires; Hidratação com Beatriz Lima; Manicure com Helena Moura');
  });

  it('item cancelado ao lado de um concluído: a reserva fica concluída e o envelope ignora o cancelado', async () => {
    const r = await c.query(`
      SELECT r.status::text AS status, r.fim = max(i.fim) FILTER (WHERE i.status <> 'cancelado') AS envelope,
             array_agg(i.status::text ORDER BY i.inicio) AS itens
        FROM reserva r JOIN reserva_item i ON i.salao_id = r.salao_id AND i.reserva_id = r.id
       GROUP BY r.id HAVING bool_or(i.status = 'cancelado') AND bool_or(i.status <> 'cancelado')`);
    expect(r.rows).toEqual([{ status: 'concluido', envelope: true, itens: ['concluido', 'cancelado'] }]);
  });
});

describe('CA-8: README documenta as credenciais do seed', () => {
  const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
  it.each([
    ['senha de demonstração', CREDENCIAIS_DEMO.senha],
    ['gestora A', CREDENCIAIS_DEMO.gestorA.email],
    ['gestor B', CREDENCIAIS_DEMO.gestorB.email],
    ['profissional A', CREDENCIAIS_DEMO.profissionalA.email],
    ['e-mail do super admin', CREDENCIAIS_DEMO.admin.email],
    ['senha do super admin', CREDENCIAIS_DEMO.admin.senha],
  ])('%s consta no README', (_n, valor) => {
    expect(readme).toContain(valor);
  });
  it('lista os comandos e o aviso de produção', () => {
    expect(readme).toContain('npm run db:seed');
    expect(readme).toContain('node dist/prisma/seed.js');
    expect(readme).toMatch(/nunca (use|rode)[^\n]*produ[cç][aã]o/i);
  });
});
