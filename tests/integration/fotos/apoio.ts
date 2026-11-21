import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import { gerarChave } from '@/server/integrations/armazenamento/chave';

export { ACESSO_NEGADO, NAO_AUTENTICADO, NAO_ENCONTRADO, UUID_INEXISTENTE, credGestor, credProfissional, ctxDoGestor, ctxDoProfissional, linhaSalao } from '../salao/apoio';

// Apoio local aos testes das fotos (D-021 T-6). Não é arquivo de teste (o glob do Vitest só pega
// *.test.ts). SQL direto pelo driver `pg` na base deste worker, sem mocks de banco.

export type LinhaFoto = {
  id: string;
  posicao: number;
  alt: string;
  chave: string;
  largura: number;
  altura: number;
  bytes: number;
  envio: string;
};

/** Insere uma foto direto no banco (cenários), na posição dada (padrão: contagem + 1). */
export async function inserirFoto(
  c: pg.Client,
  salaoId: string,
  o: { posicao?: number; alt?: string; chave?: string; envio?: string } = {},
): Promise<LinhaFoto> {
  const posicao = o.posicao ?? (await fotosDe(c, salaoId)).length + 1;
  const { rows } = await c.query<LinhaFoto>(
    `INSERT INTO salao_foto (salao_id, chave, alt, posicao, largura, altura, bytes, envio)
     VALUES ($1, $2, $3, $4, 640, 480, 1000, $5)
     RETURNING id::text AS id, posicao, alt, chave, largura, altura, bytes, envio::text AS envio`,
    [salaoId, o.chave ?? gerarChave(), o.alt ?? `Foto ${posicao}`, posicao, o.envio ?? randomUUID()],
  );
  return rows[0];
}

/** Fotos do salão por posição (todas as colunas relevantes). */
export async function fotosDe(c: pg.Client, salaoId: string): Promise<LinhaFoto[]> {
  const { rows } = await c.query<LinhaFoto>(
    `SELECT id::text AS id, posicao, alt, chave, largura, altura, bytes, envio::text AS envio
       FROM salao_foto WHERE salao_id = $1 ORDER BY posicao`,
    [salaoId],
  );
  return rows;
}

/** Cria `n` fotos nas posições 1..n. */
export async function criarFotos(c: pg.Client, salaoId: string, n: number): Promise<LinhaFoto[]> {
  const fotos: LinhaFoto[] = [];
  for (let i = 1; i <= n; i++) fotos.push(await inserirFoto(c, salaoId, { posicao: i }));
  return fotos;
}

/** Fotografia (to_jsonb, com xmin) de toda a tabela salao_foto do salão: prova de "nada mudou". */
export async function fotografiaFotos(c: pg.Client, salaoId: string): Promise<unknown[]> {
  const { rows } = await c.query<{ j: unknown }>(
    'SELECT to_jsonb(f) || jsonb_build_object($2::text, f.xmin::text) AS j FROM salao_foto f WHERE salao_id = $1 ORDER BY posicao',
    [salaoId, 'xmin'],
  );
  return rows.map((r) => r.j);
}

/** Posições do salão, em ordem. */
export async function posicoesDe(c: pg.Client, salaoId: string): Promise<number[]> {
  return (await fotosDe(c, salaoId)).map((f) => f.posicao);
}
