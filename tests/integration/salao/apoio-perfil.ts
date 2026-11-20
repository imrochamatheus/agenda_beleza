import type pg from 'pg';

export { ACESSO_NEGADO, NAO_AUTENTICADO, NAO_ENCONTRADO, UUID_INEXISTENTE, credGestor, credProfissional, ctxDoGestor, ctxDoProfissional, linhaSalao } from './apoio';

// Apoio local aos testes do perfil e do funcionamento (D-020 T-6). Não é arquivo de teste (o glob do
// Vitest só pega *.test.ts). SQL direto pelo driver `pg` na base deste worker, sem mocks de banco.

/** Entrada do formulário do perfil completa e válida (textos como digitados), com sobrescritas. */
export function perfilCompleto(sobrescritas: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    descricao: 'Salão aconchegante.\r\nAtendemos com hora marcada.',
    logradouro: 'Av.  Paulista',
    numero: 'S/N',
    complemento: 'Sala 2',
    bairro: 'Bela Vista',
    cidade: 'São Paulo',
    uf: 'sp',
    cep: '01310-100',
    telefone: '(11) 3456-7890',
    whatsapp: '+55 11 98765-4321',
    instagram: 'https://www.instagram.com/Meu.Salao/?igsh=x',
    meiosPagamento: ['pix', 'dinheiro', 'pix'],
    comodidades: ['wifi', 'acessibilidade'],
    ...sobrescritas,
  };
}

type Linha = [string, string];

/** Entrada do funcionamento: 7 dias (os omitidos ficam vazios). Índice = dia (0 = domingo). */
export function funcionamento(modo: unknown, dias: Partial<Record<number, Linha[]>> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    modo,
    dias: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ diaSemana: d, intervalos: (dias[d] ?? []).map(([inicio, fim]) => ({ inicio, fim })) })),
    ...extra,
  };
}

/** Segunda a sábado 09:00–18:00. */
export const SEG_A_SAB: Partial<Record<number, Linha[]>> = Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [d, [['09:00', '18:00']]]));

export type LinhaFuncionamento = { id: string; dia_semana: number; inicio_min: number; fim_min: number };

/** Linhas de salao_funcionamento do salão com ids, por dia e início. */
export async function funcionamentoDe(c: pg.Client, salaoId: string): Promise<LinhaFuncionamento[]> {
  const { rows } = await c.query<LinhaFuncionamento>(
    'SELECT id::text AS id, dia_semana, inicio_min, fim_min FROM salao_funcionamento WHERE salao_id = $1 ORDER BY dia_semana, inicio_min',
    [salaoId],
  );
  return rows;
}

/** (dia, início, fim) das linhas, sem ids. */
export async function semanaDe(c: pg.Client, salaoId: string): Promise<[number, number, number][]> {
  return (await funcionamentoDe(c, salaoId)).map((l) => [l.dia_semana, l.inicio_min, l.fim_min]);
}

/** Versão da linha do salão (xmin) e atualizado_em, em texto exato do banco. */
export async function versaoSalao(c: pg.Client, salaoId: string): Promise<{ xmin: string; atualizado_em: string; funcionamento_definido: boolean }> {
  const { rows } = await c.query<{ xmin: string; atualizado_em: string; funcionamento_definido: boolean }>(
    'SELECT xmin::text AS xmin, atualizado_em::text AS atualizado_em, funcionamento_definido FROM salao WHERE id = $1',
    [salaoId],
  );
  return rows[0];
}

/** Fotografia (to_jsonb) de reserva, reserva_item, jornada e bloqueio do salão e de toda a tabela mensagem. */
export async function fotografiaOutrosDados(c: pg.Client, salaoId: string): Promise<Record<string, unknown[]>> {
  const r: Record<string, unknown[]> = {};
  for (const tabela of ['reserva', 'reserva_item', 'jornada', 'bloqueio']) {
    const { rows } = await c.query<{ j: unknown }>(`SELECT to_jsonb(t) AS j FROM ${tabela} t WHERE salao_id = $1 ORDER BY id`, [salaoId]);
    r[tabela] = rows.map((l) => l.j);
  }
  const { rows } = await c.query<{ j: unknown }>('SELECT to_jsonb(m) AS j FROM mensagem m ORDER BY id');
  r.mensagem = rows.map((l) => l.j);
  return r;
}
