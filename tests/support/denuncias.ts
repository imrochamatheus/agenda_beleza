import type pg from 'pg';

import { TOKEN_TURNSTILE_SIMULADO } from '@/server/integrations/turnstile/port';
import { hashIpDenuncia } from '@/server/protecao/chaves';
import type { EntradaDenuncia } from '@/server/denuncias/tipos';

import { criarAvaliavel } from '../integration/avaliacoes/apoio';
import type { SalaoCompleto } from './factories';

// Apoio dos testes de denúncia e moderação (D-035). SQL direto pelo driver `pg`; sem mocks de banco.

export const AGORA = new Date('2026-11-22T12:00:00Z');

export type AvaliacaoDeTeste = { avaliacaoId: string; reservaId: string; clienteId: string };

/** Avaliação publicada (reserva concluída, cliente não anonimizada) inserida direto no salão. */
export async function criarAvaliacao(
  c: pg.Client,
  s: SalaoCompleto,
  o: { nota?: number; nome?: string; comentario?: string | null; status?: 'concluido' | 'cancelado'; retirada?: boolean } = {},
): Promise<AvaliacaoDeTeste> {
  const k = await criarAvaliavel(c, s, { nome: 'Cliente de Teste', status: o.status ?? 'concluido' });
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO avaliacao (salao_id, reserva_id, cliente_id, nota, comentario, nome_exibicao, publicacao_aceita_em, versao_termos, retirada_em)
     VALUES ($1, $2, $3, $4, $5, $6, now(), 'v1', $7) RETURNING id::text AS id`,
    [
      s.salaoId, k.reservaId, k.clienteId, o.nota ?? 5, o.comentario === undefined ? 'Ótimo atendimento' : o.comentario,
      o.nome ?? 'Cliente T.', o.retirada ? new Date('2026-11-20T00:00:00Z') : null,
    ],
  );
  return { avaliacaoId: rows[0].id, reservaId: k.reservaId, clienteId: k.clienteId };
}

export function entradaDenuncia(avaliacaoId: string, sobre: Partial<EntradaDenuncia> = {}): EntradaDenuncia {
  return { avaliacaoId, motivo: 'spam', texto: 'Propaganda de outro lugar', ip: '203.0.113.10', tokenHumano: TOKEN_TURNSTILE_SIMULADO, ...sobre };
}

export const SEMPRE_PERMITIDO = async () => ({ permitido: true as const });

export type LinhaDenuncia = {
  id: string; salao_id: string; avaliacao_id: string; motivo: string; texto: string | null; ip_hash: string;
  resolvida_em: Date | null; resolvida_por: string | null; resolucao: string | null;
};

export async function denunciasDe(c: pg.Client, avaliacaoId: string): Promise<LinhaDenuncia[]> {
  const { rows } = await c.query<LinhaDenuncia>(
    `SELECT id::text, salao_id::text, avaliacao_id::text, motivo::text, texto, ip_hash, resolvida_em, resolvida_por::text, resolucao
       FROM avaliacao_denuncia WHERE avaliacao_id = $1 ORDER BY criado_em, id`,
    [avaliacaoId],
  );
  return rows;
}

export async function totalDeDenuncias(c: pg.Client): Promise<number> {
  const { rows } = await c.query<{ n: string }>('SELECT count(*) AS n FROM avaliacao_denuncia');
  return Number(rows[0].n);
}

/** Insere `n` denúncias pendentes de IPs distintos (para o teto), com `ip_hash` HMAC como em produção. */
export async function semearPendentes(c: pg.Client, s: SalaoCompleto, avaliacaoId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await c.query(
      `INSERT INTO avaliacao_denuncia (salao_id, avaliacao_id, motivo, ip_hash) VALUES ($1, $2, 'outro', $3)`,
      [s.salaoId, avaliacaoId, hashIpDenuncia(`10.0.${i}.1`)],
    );
  }
}

export async function linhaDaAvaliacao(c: pg.Client, id: string): Promise<{ retirada_em: Date | null; retirada_por: string | null }> {
  const { rows } = await c.query<{ retirada_em: Date | null; retirada_por: string | null }>(
    'SELECT retirada_em, retirada_por::text FROM avaliacao WHERE id = $1', [id],
  );
  return rows[0];
}

export async function contarMensagens(c: pg.Client): Promise<number> {
  const { rows } = await c.query<{ n: string }>('SELECT count(*) AS n FROM mensagem');
  return Number(rows[0].n);
}
