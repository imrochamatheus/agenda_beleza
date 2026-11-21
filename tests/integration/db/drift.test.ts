import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { executarPrisma, urlDoWorker } from '../../support/db';
import { conectar } from '../../support/sql';

// CA-1 (RN-11), CA-15 (RN-3) e CA-22 (RN-13) da D-004, CA-24 da D-007 e a migração da D-020. Os nomes vêm
// dos contratos de docs/demandas/D-004/dba.md §3, docs/demandas/D-007/dba.md §3 e docs/demandas/D-020/dba.md §2.
// O `migrate diff` é cego aos objetos de SQL bruto (design §0), por isso o catálogo os confere pelo nome.
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

async function linhas<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await c.query<T>(sql, params)).rows;
}

const TABELAS = [
  'assinatura',
  'assinatura_pagamento',
  'assinatura_transicao',
  'auditoria',
  'bloqueio',
  'cliente',
  'consentimento',
  'convite',
  'email_log',
  'jornada',
  'mensagem',
  'mensagem_tentativa',
  'profissional',
  'rate_limit_janela',
  'reserva',
  'reserva_item',
  'salao',
  'salao_slug',
  // D-020: horário de funcionamento do salão.
  'salao_funcionamento',
  // D-021: fotos do salão.
  'salao_foto',
  'servico',
  'servico_profissional',
  'sessao',
  'token',
  'usuario',
  'webhook_evento',
  // D-007: estado dos adaptadores simulados (tabelas de plataforma, vazias em produção).
  'sim_mp_assinatura',
  'sim_mp_pagamento',
  'sim_mp_adiamento',
  'sim_mp_erro_forcado',
  'sim_whatsapp_chamada',
  'sim_whatsapp_falha_forcada',
];

const TABELAS_SIMULADOS = TABELAS.filter((t) => t.startsWith('sim_'));

const ENUMS: Record<string, string[]> = {
  papel_usuario: ['gestor', 'profissional', 'super_admin'],
  tipo_token: ['confirmacao_email', 'recuperacao_senha'],
  status_reserva: ['confirmado', 'cancelado', 'concluido', 'nao_compareceu'],
  origem_reserva: ['publico', 'equipe'],
  finalidade_consentimento: ['mensagens_reserva', 'convite_avaliacao', 'publicacao_avaliacao'],
  origem_consentimento: ['publico', 'equipe'],
  estado_assinatura: ['pendente', 'em_teste', 'ativa', 'em_carencia', 'suspensa', 'cancelada', 'encerrada'],
  resultado_webhook: ['recebido', 'processado', 'ignorado', 'rejeitado', 'erro'],
  tipo_mensagem: ['confirmacao', 'remarcacao', 'cancelamento'],
  estado_mensagem: ['pendente', 'enviando', 'enviada', 'falhou', 'nao_enviada', 'substituida', 'cancelada_anonimizacao'],
  resultado_tentativa: ['sucesso', 'falha'],
  resultado_auditoria: ['sucesso', 'falha'],
  sim_mp_estado_assinatura: ['pendente', 'autorizada', 'cancelada'],
  sim_mp_status_pagamento: ['aprovado', 'recusado'],
  sim_mp_operacao: ['criarAssinatura', 'consultarAssinatura', 'consultarPagamento', 'cancelarAssinatura', 'adiarProximaCobranca'],
  sim_whatsapp_tipo_falha: ['temporaria', 'permanente'],
};

// [nome, tabela, contype]
const CONSTRAINTS_SQL_BRUTO: [string, string, 'x' | 'c'][] = [
  ['reserva_sem_sobreposicao', 'reserva', 'x'],
  ['jornada_sem_sobreposicao', 'jornada', 'x'],
  ['reserva_ordem_chk', 'reserva', 'c'],
  ['cliente_anonimizacao_chk', 'cliente', 'c'],
  ['cliente_telefone_e164_chk', 'cliente', 'c'],
  ['mensagem_destinatario_e164_chk', 'mensagem', 'c'],
  ['salao_slug_formato_chk', 'salao_slug', 'c'],
  ['usuario_email_minusculo_chk', 'usuario', 'c'],
  ['usuario_papel_salao_chk', 'usuario', 'c'],
  ['convite_email_minusculo_chk', 'convite', 'c'],
  ['jornada_dia_semana_chk', 'jornada', 'c'],
  ['jornada_faixa_chk', 'jornada', 'c'],
  ['servico_preco_chk', 'servico', 'c'],
  ['servico_duracao_chk', 'servico', 'c'],
  ['reserva_item_preco_chk', 'reserva_item', 'c'],
  ['reserva_item_duracao_chk', 'reserva_item', 'c'],
  ['assinatura_pagamento_valor_chk', 'assinatura_pagamento', 'c'],
  ['bloqueio_ordem_chk', 'bloqueio', 'c'],
  // D-007 (migração 20261119000000_simuladores_integracao, parte 2)
  ['sim_mp_assinatura_estado_chk', 'sim_mp_assinatura', 'c'],
  ['sim_mp_assinatura_valor_chk', 'sim_mp_assinatura', 'c'],
  ['sim_mp_pagamento_valor_chk', 'sim_mp_pagamento', 'c'],
  ['sim_whatsapp_chamada_resultado_chk', 'sim_whatsapp_chamada', 'c'],
  // D-020 (migração 20261120000000_perfil_funcionamento, parte 2)
  ['salao_funcionamento_sem_sobreposicao', 'salao_funcionamento', 'x'],
  ['salao_funcionamento_dia_semana_chk', 'salao_funcionamento', 'c'],
  ['salao_funcionamento_faixa_chk', 'salao_funcionamento', 'c'],
  ['salao_meios_pagamento_chk', 'salao', 'c'],
  ['salao_comodidades_chk', 'salao', 'c'],
  ['salao_descricao_chk', 'salao', 'c'],
  ['salao_endereco_logradouro_chk', 'salao', 'c'],
  ['salao_endereco_numero_chk', 'salao', 'c'],
  ['salao_endereco_complemento_chk', 'salao', 'c'],
  ['salao_endereco_bairro_chk', 'salao', 'c'],
  ['salao_endereco_cidade_chk', 'salao', 'c'],
  ['salao_endereco_uf_chk', 'salao', 'c'],
  ['salao_endereco_cep_chk', 'salao', 'c'],
  ['salao_endereco_completo_chk', 'salao', 'c'],
  ['salao_telefone_e164_chk', 'salao', 'c'],
  ['salao_whatsapp_e164_chk', 'salao', 'c'],
  ['salao_instagram_chk', 'salao', 'c'],
  // D-021 (migração 20261121000000_salao_foto, parte 2)
  ['salao_foto_posicao_chk', 'salao_foto', 'c'],
  ['salao_foto_dimensoes_chk', 'salao_foto', 'c'],
  ['salao_foto_bytes_chk', 'salao_foto', 'c'],
  ['salao_foto_alt_chk', 'salao_foto', 'c'],
  ['salao_foto_chave_chk', 'salao_foto', 'c'],
  ['consentimento_origem_finalidade_chk', 'consentimento', 'c'],
  ['consentimento_versao_termos_chk', 'consentimento', 'c'],
];

// [nome, tabela, único]
const INDICES_SQL_BRUTO: [string, string, boolean][] = [
  ['usuario_gestor_por_salao_uniq', 'usuario', true],
  ['salao_slug_atual_uniq', 'salao_slug', true],
  ['assinatura_vigente_por_salao_uniq', 'assinatura', true],
  ['webhook_evento_dedupe_uniq', 'webhook_evento', true],
  ['reserva_cliente_confirmada_idx', 'reserva', false],
  ['mensagem_pendentes_idx', 'mensagem', false],
  ['bloqueio_periodo_idx', 'bloqueio', false],
];

// tgtype: 27 = BEFORE | ROW | DELETE | UPDATE; 34 = BEFORE | TRUNCATE (por instrução).
const TRIGGERS: [string, string, number][] = [
  ['auditoria_somente_insercao_linha', 'auditoria', 27],
  ['auditoria_somente_insercao_truncate', 'auditoria', 34],
  ['assinatura_transicao_somente_insercao_linha', 'assinatura_transicao', 27],
  ['assinatura_transicao_somente_insercao_truncate', 'assinatura_transicao', 34],
];

const FKS_COMPOSTAS = [
  'reserva_salao_id_profissional_id_fkey',
  'reserva_salao_id_cliente_id_fkey',
  'reserva_item_salao_id_reserva_id_fkey',
  'reserva_item_salao_id_servico_id_fkey',
  'servico_profissional_salao_id_servico_id_fkey',
  'servico_profissional_salao_id_profissional_id_fkey',
  'jornada_salao_id_profissional_id_fkey',
  'bloqueio_salao_id_profissional_id_fkey',
  'mensagem_salao_id_reserva_id_fkey',
  'consentimento_salao_id_cliente_id_fkey',
  'convite_salao_id_profissional_id_fkey',
  'profissional_salao_id_usuario_id_fkey',
];

describe('CA-1: catálogo depois do migrate deploy', () => {
  it('CA-1: existem exatamente as tabelas do contrato em public (fora _prisma_migrations)', async () => {
    const r = await linhas<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
       ORDER BY table_name`,
    );
    expect(r.map((x) => x.table_name)).toEqual([...TABELAS].sort());
  });

  it('CA-1: os enums têm exatamente os valores do contrato, na ordem', async () => {
    const r = await linhas<{ tipo: string; valores: string[] }>(
      `SELECT t.typname AS tipo, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS valores
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typnamespace = 'public'::regnamespace GROUP BY t.typname`,
    );
    expect(Object.fromEntries(r.map((x) => [x.tipo, x.valores]))).toEqual(ENUMS);
  });

  it('CA-1: a extensão btree_gist está instalada', async () => {
    expect(await linhas("SELECT extname FROM pg_extension WHERE extname = 'btree_gist'")).toEqual([
      { extname: 'btree_gist' },
    ]);
  });

  it('CA-1: cada exclusion e CHECK de SQL bruto existe pelo nome, na tabela e com o tipo certos', async () => {
    const r = await linhas<{ nome: string; tabela: string; tipo: string }>(
      `SELECT conname AS nome, conrelid::regclass::text AS tabela, contype::text AS tipo
       FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype IN ('x', 'c')
       ORDER BY conname`,
    );
    expect(r).toEqual(
      CONSTRAINTS_SQL_BRUTO.map(([nome, tabela, tipo]) => ({ nome, tabela, tipo })).sort((a, b) =>
        a.nome.localeCompare(b.nome),
      ),
    );
  });

  it('D-020: salao_funcionamento_sem_sobreposicao usa (salao_id, dia_semana, int4range) sem predicado', async () => {
    const [r] = await linhas<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'salao_funcionamento_sem_sobreposicao'",
    );
    expect(r.def).toBe('EXCLUDE USING gist (salao_id WITH =, dia_semana WITH =, int4range(inicio_min, fim_min) WITH &&)');
  });

  it('D-021: salao_foto_posicao_unica é UNIQUE (salao_id, posicao) DEFERRABLE INITIALLY DEFERRED (o diff do Prisma não vê o diferimento)', async () => {
    const r = await linhas<{ tipo: string; adiavel: boolean; adiada: boolean; def: string }>(
      `SELECT contype::text AS tipo, condeferrable AS adiavel, condeferred AS adiada, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE conname = 'salao_foto_posicao_unica' AND conrelid = 'salao_foto'::regclass`,
    );
    expect(r).toEqual([
      {
        tipo: 'u',
        adiavel: true,
        adiada: true,
        def: 'UNIQUE (salao_id, posicao) DEFERRABLE INITIALLY DEFERRED',
      },
    ]);
  });

  it('D-020: as listas do perfil são text[] NOT NULL com default vazio (o diff do Prisma não confere a nulidade)', async () => {
    const r = await linhas<{ coluna: string; tipo: string; nulo: string; padrao: string | null }>(
      `SELECT column_name AS coluna, udt_name AS tipo, is_nullable AS nulo, column_default AS padrao
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'salao' AND column_name IN ('meios_pagamento', 'comodidades')
       ORDER BY column_name`,
    );
    expect(r).toEqual([
      { coluna: 'comodidades', tipo: '_text', nulo: 'NO', padrao: 'ARRAY[]::text[]' },
      { coluna: 'meios_pagamento', tipo: '_text', nulo: 'NO', padrao: 'ARRAY[]::text[]' },
    ]);
  });

  it('CA-1 (RN-7): reserva_sem_sobreposicao usa tstzrange(inicio, ocupado_ate) e só os status ativos', async () => {
    const [r] = await linhas<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'reserva_sem_sobreposicao'",
    );
    expect(r.def).toContain('EXCLUDE USING gist (profissional_id WITH =, tstzrange(inicio, ocupado_ate, \'[)\'::text) WITH &&)');
    expect(r.def).toContain("'confirmado'::status_reserva");
    expect(r.def).toContain("'concluido'::status_reserva");
    expect(r.def).toContain("'nao_compareceu'::status_reserva");
    expect(r.def).not.toContain("'cancelado'");
  });

  it('CA-1: cada índice de SQL bruto existe pelo nome, na tabela certa e com a unicidade certa', async () => {
    const r = await linhas<{ nome: string; tabela: string; unico: boolean }>(
      `SELECT i.relname AS nome, t.relname AS tabela, x.indisunique AS unico
       FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid
       WHERE i.relname = ANY($1) ORDER BY i.relname`,
      [INDICES_SQL_BRUTO.map(([n]) => n)],
    );
    expect(r).toEqual(
      INDICES_SQL_BRUTO.map(([nome, tabela, unico]) => ({ nome, tabela, unico })).sort((a, b) =>
        a.nome.localeCompare(b.nome),
      ),
    );
  });

  it('CA-1 (RN-10): os triggers append-only existem com o tgtype do contrato e chamam a função', async () => {
    const r = await linhas<{ nome: string; tabela: string; tgtype: number; funcao: string }>(
      // A-10 (D-005): só triggers de public; schemas dos inicializadores (harness_extensao, pgboss) ficam fora.
      `SELECT t.tgname AS nome, t.tgrelid::regclass::text AS tabela, t.tgtype::int AS tgtype, t.tgfoid::regproc::text AS funcao
       FROM pg_trigger t JOIN pg_class cl ON cl.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND cl.relnamespace = 'public'::regnamespace ORDER BY t.tgname`,
    );
    expect(r).toEqual(
      TRIGGERS.map(([nome, tabela, tgtype]) => ({
        nome,
        tabela,
        tgtype,
        funcao: 'rejeitar_alteracao_somente_insercao',
      })).sort((a, b) => a.nome.localeCompare(b.nome)),
    );
  });

  it('CA-1 (RN-1): nenhuma coluna timestamp sem fuso em public (fora _prisma_migrations)', async () => {
    const r = await linhas(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type = 'timestamp without time zone' AND table_name <> '_prisma_migrations'`,
    );
    expect(r).toEqual([]);
  });
});

describe('CA-1: o Prisma não acusa drift', () => {
  it(
    'CA-1: migrate diff --from-config-datasource --to-schema sai com 0 (sem diferença)',
    () => {
      const r = executarPrisma(
        ['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'],
        urlDoWorker(),
      );
      expect(r.stderr).not.toMatch(/error/i);
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).toContain('No difference detected');
    },
    60_000,
  );

  it(
    'CA-1 (controle negativo): com um model a mais no schema, o mesmo diff sai com 2',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'd004-drift-'));
      try {
        const schema = join(dir, 'schema.prisma');
        writeFileSync(
          schema,
          `${readFileSync(fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url)), 'utf8')}\nmodel ControleDrift {\n  id Int @id\n}\n`,
        );
        const r = executarPrisma(
          ['migrate', 'diff', '--from-config-datasource', '--to-schema', schema, '--exit-code'],
          urlDoWorker(),
        );
        expect(r.status).toBe(2);
        expect(r.stdout).toContain('ControleDrift');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

describe('CA-15: integridade referencial e identificadores', () => {
  it('CA-15: as 39 FKs de public são ON DELETE RESTRICT e ON UPDATE RESTRICT', async () => {
    const r = await linhas<{ nome: string; del: string; upd: string }>(
      `SELECT conname AS nome, confdeltype::text AS del, confupdtype::text AS upd
       FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
    );
    expect(r).toHaveLength(39); // 37 até a D-007 + salao_funcionamento_salao_id_fkey (D-020) + salao_foto_salao_id_fkey (D-021)
    expect(r.filter((f) => f.del !== 'r' || f.upd !== 'r')).toEqual([]);
  });

  it('CA-15 (RN-2): as FKs compostas do contrato existem e têm (salao_id, x_id) como colunas', async () => {
    const r = await linhas<{ nome: string; colunas: string[] }>(
      `SELECT conname AS nome,
              array(SELECT attname FROM unnest(conkey) WITH ORDINALITY k(n, o)
                    JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k.n ORDER BY k.o)::text[] AS colunas
       FROM pg_constraint WHERE contype = 'f' AND conname = ANY($1) ORDER BY conname`,
      [FKS_COMPOSTAS],
    );
    expect(r.map((f) => f.nome)).toEqual([...FKS_COMPOSTAS].sort());
    for (const f of r) {
      expect(f.colunas).toHaveLength(2);
      expect(f.colunas[0]).toBe('salao_id');
    }
  });

  it('CA-15 (RN-3): toda coluna id é uuid com default gen_random_uuid()', async () => {
    const r = await linhas<{ tabela: string; tipo: string; padrao: string | null }>(
      `SELECT table_name AS tabela, udt_name AS tipo, column_default AS padrao FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'id' AND table_name <> '_prisma_migrations'`,
    );
    expect(r.filter((x) => x.tipo !== 'uuid' || x.padrao !== 'gen_random_uuid()')).toEqual([]);
    // Tabelas sem id: PKs compostas (rate_limit_janela, servico_profissional) e o slug como PK (salao_slug).
    const semId = TABELAS.filter((t) => !r.some((x) => x.tabela === t));
    expect(semId).toEqual(['rate_limit_janela', 'salao_slug', 'servico_profissional']);
  });

  it('CA-15 (RN-3): criado_em e os instantes de registro têm default now() no banco', async () => {
    const r = await linhas<{ tabela: string; coluna: string; padrao: string | null }>(
      `SELECT table_name AS tabela, column_name AS coluna, column_default AS padrao FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name IN ('criado_em', 'ocorrido_em', 'ocorrida_em', 'recebido_em', 'iniciada_em')`,
    );
    // O Prisma grava @default(now()) como CURRENT_TIMESTAMP, que é o mesmo que now() no PostgreSQL.
    expect(r.filter((x) => x.padrao !== 'CURRENT_TIMESTAMP' && x.padrao !== 'now()')).toEqual([]);
    // Exceções a criado_em registradas no dba.md: auditoria (ocorrido_em), assinatura_transicao
    // (ocorrida_em), webhook_evento (recebido_em) e mensagem_tentativa (iniciada_em).
    const coluna = Object.fromEntries(r.filter((x) => x.coluna !== 'criado_em').map((x) => [x.tabela, x.coluna]));
    expect(coluna).toEqual({
      auditoria: 'ocorrido_em',
      assinatura_transicao: 'ocorrida_em',
      webhook_evento: 'recebido_em',
      mensagem_tentativa: 'iniciada_em',
    });
    // Só rate_limit_janela (contador por janela, PK chave + janela_inicio) não tem instante de registro.
    expect(TABELAS.filter((t) => !r.some((x) => x.tabela === t))).toEqual(['rate_limit_janela']);
  });
});

describe('CA-22: o reset desta execução não depende de TRUNCATE', () => {
  it('CA-22: as migrações foram aplicadas nesta execução e nada de uma execução anterior sobrou em auditoria', async () => {
    const inicio = new Date(inject('inicioDoReset'));
    const migracoes = await linhas<{ migration_name: string; antes: boolean; ok: boolean }>(
      `SELECT migration_name, started_at < $1 AS antes, (finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok
       FROM _prisma_migrations ORDER BY migration_name`,
      [inicio],
    );
    expect(migracoes).toEqual([
      { migration_name: '20261118000000_init', antes: false, ok: true },
      { migration_name: '20261118000100_reserva_exclusion', antes: false, ok: true },
      { migration_name: '20261118000200_restricoes_sql', antes: false, ok: true },
      { migration_name: '20261119000000_simuladores_integracao', antes: false, ok: true },
      { migration_name: '20261120000000_perfil_funcionamento', antes: false, ok: true },
      { migration_name: '20261121000000_salao_foto', antes: false, ok: true },
      { migration_name: '20261121100000_consentimento_finalidade', antes: false, ok: true },
    ]);
    const [velhas] = await linhas<{ n: number }>('SELECT count(*)::int AS n FROM auditoria WHERE ocorrido_em < $1', [
      inicio,
    ]);
    expect(velhas.n).toBe(0);
  });
});

describe('CA-24 (D-007): tabelas dos simuladores', () => {
  it('CA-24: as 6 tabelas sim_* existem, vazias, e cada uma tem o COMMENT de "somente adaptador simulado"', async () => {
    const r = await linhas<{ tabela: string; comentario: string | null }>(
      `SELECT c.relname AS tabela, obj_description(c.oid, 'pg_class') AS comentario
       FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'sim\\_%'
       ORDER BY c.relname`,
    );
    expect(r.map((x) => x.tabela)).toEqual([...TABELAS_SIMULADOS].sort());
    for (const x of r) {
      expect(x.comentario).toMatch(/^Somente adaptador simulado do (Mercado Pago|WhatsApp) \(D-007\)\. Vazia em produção\.$/);
      // Nomes vindos da lista fixa do contrato (não de entrada externa).
      const [n] = await linhas<{ n: number }>(`SELECT count(*)::int AS n FROM ${x.tabela}`);
      expect(n.n).toBe(0);
    }
  });

  it('CA-24 (D-2): nenhuma FK liga uma tabela sim_* a uma tabela de domínio (nos dois sentidos)', async () => {
    const r = await linhas<{ nome: string; origem: string; alvo: string }>(
      `SELECT conname AS nome, conrelid::regclass::text AS origem, confrelid::regclass::text AS alvo
       FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace
         AND (conrelid::regclass::text LIKE 'sim\\_%' OR confrelid::regclass::text LIKE 'sim\\_%')
       ORDER BY conname`,
    );
    expect(r).toEqual([
      { nome: 'sim_mp_adiamento_assinatura_id_fkey', origem: 'sim_mp_adiamento', alvo: 'sim_mp_assinatura' },
      { nome: 'sim_mp_pagamento_assinatura_id_fkey', origem: 'sim_mp_pagamento', alvo: 'sim_mp_assinatura' },
    ]);
  });

  it('CA-24: as colunas das tabelas sim_* são exatamente as do contrato (nenhuma de cartão, segredo ou token)', async () => {
    const r = await linhas<{ tabela: string; coluna: string; tipo: string; nulo: string; padrao: string | null }>(
      `SELECT table_name AS tabela, column_name AS coluna, udt_name AS tipo, is_nullable AS nulo, column_default AS padrao
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'sim\\_%'
       ORDER BY table_name, ordinal_position`,
    );
    const colunas = (t: string) => r.filter((x) => x.tabela === t).map((x) => x.coluna);
    expect(colunas('sim_mp_assinatura')).toEqual([
      'id', 'referencia_externa', 'email_pagador', 'url_retorno', 'estado', 'valor_centavos',
      'autorizada_em', 'proxima_cobranca_em', 'cancelada_em', 'criado_em', 'atualizado_em',
    ]);
    expect(colunas('sim_mp_pagamento')).toEqual(['id', 'assinatura_id', 'status', 'valor_centavos', 'cobrado_em', 'criado_em']);
    expect(colunas('sim_mp_adiamento')).toEqual(['id', 'assinatura_id', 'data_anterior', 'nova_data', 'criado_em']);
    expect(colunas('sim_mp_erro_forcado')).toEqual(['id', 'operacao', 'criado_em']);
    expect(colunas('sim_whatsapp_chamada')).toEqual([
      'id', 'destinatario', 'modelo', 'parametros', 'chave_idempotencia', 'resultado', 'tipo_falha',
      'provedor_mensagem_id', 'criado_em',
    ]);
    expect(colunas('sim_whatsapp_falha_forcada')).toEqual(['id', 'tipo', 'criado_em']);
    expect(r.filter((x) => /cart|card|cvv|pan|token|secret|segredo|senha|password|access|chave_api/i.test(x.coluna))).toEqual([]);
    // modelo é text (chamada inválida também é registrada, RN-19); cobrado_em não tem default (instante do disparo).
    const coluna = (t: string, c: string) => r.find((x) => x.tabela === t && x.coluna === c);
    expect(coluna('sim_whatsapp_chamada', 'modelo')).toMatchObject({ tipo: 'text', nulo: 'NO' });
    expect(coluna('sim_mp_pagamento', 'cobrado_em')).toMatchObject({ tipo: 'timestamptz', nulo: 'NO', padrao: null });
  });
});
