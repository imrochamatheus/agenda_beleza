// Fixtures do E2E com banco (D-036): preparam estado por SQL direto (`pg`) na base `_e2e` e conferem o resultado.
// Cada teste usa e-mail/telefone únicos e o salão de reservas que lhe cabe, então a ordem dos testes não importa.
import { randomInt, randomUUID } from 'node:crypto';

import pg from 'pg';

import { urlDoBancoE2E } from './ambiente';

export async function comBanco<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: urlDoBancoE2E(process.env) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Celular BR único por chamada (DDD 11, 9 + 8 dígitos), no formato digitado pela cliente. */
export function telefoneUnico(): { digitado: string; e164: string } {
  const n = String(randomInt(0, 100_000_000)).padStart(8, '0');
  return { digitado: `(11) 9${n.slice(0, 4)}-${n.slice(4)}`, e164: `+55119${n}` };
}

export type ReservaDoBanco = {
  id: string;
  profissional: string;
  inicio: Date;
  fim: Date;
  status: string;
  itens: { servico: string; ordem: number; precoCentavos: number; duracaoMin: number }[];
};

/** Reservas do telefone (E.164) no salão, com os itens em ordem. */
export async function reservasDoTelefone(slug: string, e164: string): Promise<ReservaDoBanco[]> {
  return comBanco(async (c) => {
    const r = await c.query(
      `SELECT r.id, p.nome AS profissional, r.inicio, r.fim, r.status::text AS status,
              (SELECT coalesce(json_agg(json_build_object('servico', s.nome, 'ordem', i.ordem,
                       'precoCentavos', i.preco_centavos, 'duracaoMin', i.duracao_min) ORDER BY i.ordem), '[]'::json)
                 FROM reserva_item i JOIN servico s ON s.salao_id = i.salao_id AND s.id = i.servico_id
                WHERE i.reserva_id = r.id) AS itens
         FROM reserva r
         JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
         JOIN profissional p ON p.salao_id = r.salao_id AND p.id = r.profissional_id
         JOIN salao_slug sl ON sl.salao_id = r.salao_id AND sl.slug = $1
        WHERE c.telefone_e164 = $2 ORDER BY r.inicio`,
      [slug, e164],
    );
    return r.rows.map((x) => ({ ...x, inicio: new Date(x.inicio), fim: new Date(x.fim) }));
  });
}

/**
 * Ocupa o horário do profissional com uma reserva de outra cliente (CA-16): a inserção passa pela exclusão
 * `reserva_sem_sobreposicao`, nunca a contorna. Devolve o id.
 */
export async function ocuparHorario(slug: string, profissionalNome: string, inicio: Date, minutos: number): Promise<string> {
  return comBanco(async (c) => {
    const alvo = (
      await c.query(
        `SELECT p.salao_id, p.id AS profissional_id FROM profissional p
           JOIN salao_slug sl ON sl.salao_id = p.salao_id AND sl.slug = $1 WHERE p.nome = $2`,
        [slug, profissionalNome],
      )
    ).rows[0];
    const telefone = telefoneUnico();
    const cliente = (
      await c.query(`INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, 'Concorrente', $2) RETURNING id`, [alvo.salao_id, telefone.e164])
    ).rows[0];
    const fim = new Date(inicio.getTime() + minutos * 60_000);
    const r = await c.query(
      `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
       VALUES ($1, $2, $3, $4, $5, $5, 'confirmado', 'equipe') RETURNING id`,
      [alvo.salao_id, alvo.profissional_id, cliente.id, inicio, fim],
    );
    return r.rows[0].id as string;
  });
}

/** Quantas reservas ocupantes o salão tem (confirma que nada foi criado por uma recusa). */
export async function contarReservas(slug: string): Promise<number> {
  return comBanco(async (c) => {
    const r = await c.query(
      `SELECT count(*)::int AS n FROM reserva r JOIN salao_slug sl ON sl.salao_id = r.salao_id AND sl.slug = $1`,
      [slug],
    );
    return r.rows[0].n as number;
  });
}

/**
 * Conclui "via seed" (RN-15): cria uma cliente nova e uma reserva `concluido` no passado, com o item em snapshot,
 * sem passar pelo painel. O dia é aleatório entre 60 e 3000 dias atrás (fora do que o seed ocupa).
 */
export async function criarReservaConcluida(slug: string): Promise<{ salaoId: string; reservaId: string; clienteNome: string }> {
  return comBanco(async (c) => {
    const salao = (await c.query(`SELECT salao_id FROM salao_slug WHERE slug = $1`, [slug])).rows[0];
    const prof = (await c.query(`SELECT id FROM profissional WHERE salao_id = $1 AND nome = 'Ana'`, [salao.salao_id])).rows[0];
    const servico = (await c.query(`SELECT id, preco_centavos, duracao_min FROM servico WHERE salao_id = $1 AND nome = 'Corte'`, [salao.salao_id])).rows[0];
    const clienteNome = `Cliente ${randomUUID().slice(0, 8)}`;
    const cliente = (
      await c.query(`INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, $2, $3) RETURNING id`, [salao.salao_id, clienteNome, telefoneUnico().e164])
    ).rows[0];
    const inicio = new Date(Date.now() - randomInt(60, 3000) * 86_400_000);
    inicio.setUTCMinutes(0, 0, 0);
    const fim = new Date(inicio.getTime() + servico.duracao_min * 60_000);
    const reserva = (
      await c.query(
        `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
         VALUES ($1, $2, $3, $4, $5, $5, 'concluido', 'equipe') RETURNING id`,
        [salao.salao_id, prof.id, cliente.id, inicio, fim],
      )
    ).rows[0];
    await c.query(
      `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, ordem, preco_centavos, duracao_min) VALUES ($1, $2, $3, 0, $4, $5)`,
      [salao.salao_id, reserva.id, servico.id, servico.preco_centavos, servico.duracao_min],
    );
    return { salaoId: salao.salao_id as string, reservaId: reserva.id as string, clienteNome };
  });
}

/** Avaliações do salão (publicadas e retiradas), mais recentes primeiro. */
export async function avaliacoesDoSalao(slug: string): Promise<{ nota: number; comentario: string | null; nomeExibicao: string | null; retirada: boolean }[]> {
  return comBanco(async (c) => {
    const r = await c.query(
      `SELECT a.nota, a.comentario, a.nome_exibicao, a.retirada_em IS NOT NULL AS retirada
         FROM avaliacao a JOIN salao_slug sl ON sl.salao_id = a.salao_id AND sl.slug = $1 ORDER BY a.criado_em DESC`,
      [slug],
    );
    return r.rows.map((x) => ({ nota: x.nota, comentario: x.comentario, nomeExibicao: x.nome_exibicao, retirada: x.retirada }));
  });
}

/** Denúncias do salão: motivo, e se a avaliação segue publicada. */
export async function denunciasDoSalao(slug: string): Promise<{ motivo: string; avaliacaoPublicada: boolean; pendente: boolean }[]> {
  return comBanco(async (c) => {
    const r = await c.query(
      `SELECT d.motivo::text AS motivo, a.retirada_em IS NULL AS publicada, d.resolvida_em IS NULL AS pendente
         FROM avaliacao_denuncia d JOIN avaliacao a ON a.salao_id = d.salao_id AND a.id = d.avaliacao_id
         JOIN salao_slug sl ON sl.salao_id = d.salao_id AND sl.slug = $1 ORDER BY d.criado_em`,
      [slug],
    );
    return r.rows.map((x) => ({ motivo: x.motivo, avaliacaoPublicada: x.publicada, pendente: x.pendente }));
  });
}
