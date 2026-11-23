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

/** Item gravado (D-050): cada serviço com o seu profissional, horário e status. */
export type ItemDoBanco = {
  servico: string;
  profissional: string;
  ordem: number;
  inicio: Date;
  fim: Date;
  status: string;
  precoCentavos: number;
  duracaoMin: number;
};

/** Reserva com os derivados (`status`, `inicio`, `fim`) e os itens por (inicio, id). */
export type ReservaDoBanco = {
  id: string;
  inicio: Date;
  fim: Date;
  status: string;
  itens: ItemDoBanco[];
};

type ItemJson = Omit<ItemDoBanco, 'inicio' | 'fim'> & { inicio: string; fim: string };

/** Reservas do telefone (E.164) no salão, por início, com os itens por (inicio, id). */
export async function reservasDoTelefone(slug: string, e164: string): Promise<ReservaDoBanco[]> {
  return comBanco(async (c) => {
    const r = await c.query(
      `SELECT r.id, r.inicio, r.fim, r.status::text AS status,
              (SELECT coalesce(json_agg(json_build_object('servico', s.nome, 'profissional', p.nome, 'ordem', i.ordem,
                       'inicio', i.inicio, 'fim', i.fim, 'status', i.status::text,
                       'precoCentavos', i.preco_centavos, 'duracaoMin', i.duracao_min) ORDER BY i.inicio, i.id), '[]'::json)
                 FROM reserva_item i
                 JOIN servico s ON s.salao_id = i.salao_id AND s.id = i.servico_id
                 JOIN profissional p ON p.salao_id = i.salao_id AND p.id = i.profissional_id
                WHERE i.salao_id = r.salao_id AND i.reserva_id = r.id) AS itens
         FROM reserva r
         JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
         JOIN salao_slug sl ON sl.salao_id = r.salao_id AND sl.slug = $1
        WHERE c.telefone_e164 = $2 ORDER BY r.inicio, r.id`,
      [slug, e164],
    );
    return r.rows.map((x) => ({
      id: x.id,
      inicio: new Date(x.inicio),
      fim: new Date(x.fim),
      status: x.status,
      itens: (x.itens as ItemJson[]).map((i) => ({ ...i, inicio: new Date(i.inicio), fim: new Date(i.fim) })),
    }));
  });
}

/**
 * Grava, num ÚNICO comando, uma reserva de 1 item com os derivados coerentes (status, início e fim da reserva
 * iguais aos do item; D-050 A-1/A-2). O item passa por `reserva_item_sem_sobreposicao`: nunca a contorna.
 * `ocupado_ate` = fim + intervalo do salão (a mesma regra da criação).
 */
async function inserirReservaDeUmItem(
  c: pg.Client,
  d: { salaoId: string; profissionalId: string; servicoId: string; clienteId: string; inicio: Date; minutos: number; status: 'confirmado' | 'concluido' },
): Promise<string> {
  const fim = new Date(d.inicio.getTime() + d.minutos * 60_000);
  const r = await c.query(
    `WITH s AS (
       SELECT v.preco_centavos, sa.intervalo_min
         FROM servico v JOIN salao sa ON sa.id = v.salao_id
        WHERE v.salao_id = $1 AND v.id = $3
     ), r AS (
       INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem)
       SELECT $1, $4, $5, $6, $7::status_reserva, 'equipe' FROM s RETURNING id
     )
     INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, inicio, fim, ocupado_ate,
                               status, preco_centavos, duracao_min)
     SELECT $1, r.id, $3, $2, 0, $5, $6, $6::timestamptz + make_interval(mins => s.intervalo_min),
            $7::status_reserva, s.preco_centavos, $8
       FROM r, s
     RETURNING reserva_id`,
    [d.salaoId, d.profissionalId, d.servicoId, d.clienteId, d.inicio, fim, d.status, d.minutos],
  );
  // Sem o serviço no salão, nenhuma das duas linhas é gravada (as duas leem `s`).
  if (r.rowCount !== 1) throw new Error('fixture: serviço não encontrado no salão');
  return r.rows[0].reserva_id as string;
}

/**
 * Ocupa o horário do profissional com uma reserva de outra cliente (CA-16): um item de `minutos` minutos do
 * primeiro serviço (por nome) que ele executa, ou do `servicoNome` informado. Devolve o id da reserva.
 */
export async function ocuparHorario(
  slug: string,
  profissionalNome: string,
  inicio: Date,
  minutos: number,
  servicoNome?: string,
): Promise<string> {
  return comBanco(async (c) => {
    const alvo = (
      await c.query(
        `SELECT p.salao_id, p.id AS profissional_id,
                (SELECT v.id FROM servico_profissional sp JOIN servico v ON v.salao_id = sp.salao_id AND v.id = sp.servico_id
                  WHERE sp.salao_id = p.salao_id AND sp.profissional_id = p.id AND ($3::text IS NULL OR v.nome = $3)
                  ORDER BY v.nome, v.id LIMIT 1) AS servico_id
           FROM profissional p
           JOIN salao_slug sl ON sl.salao_id = p.salao_id AND sl.slug = $1 WHERE p.nome = $2`,
        [slug, profissionalNome, servicoNome ?? null],
      )
    ).rows[0];
    if (!alvo?.servico_id) throw new Error(`fixture: ${profissionalNome} não executa o serviço pedido em ${slug}`);
    const cliente = (
      await c.query(`INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, 'Concorrente', $2) RETURNING id`, [alvo.salao_id, telefoneUnico().e164])
    ).rows[0];
    return inserirReservaDeUmItem(c, {
      salaoId: alvo.salao_id,
      profissionalId: alvo.profissional_id,
      servicoId: alvo.servico_id,
      clienteId: cliente.id,
      inicio,
      minutos,
      status: 'confirmado',
    });
  });
}

/** Quantas reservas o salão tem (confirma que nada foi criado por uma recusa). */
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
 * Conclui "via seed" (RN-15): cria uma cliente nova e uma reserva `concluido` no passado, com o item (Corte com
 * Ana) em snapshot, sem passar pelo painel. O dia é aleatório entre 60 e 3000 dias atrás (fora do que o seed ocupa).
 */
export async function criarReservaConcluida(slug: string): Promise<{ salaoId: string; reservaId: string; clienteNome: string }> {
  return comBanco(async (c) => {
    const salao = (await c.query(`SELECT salao_id FROM salao_slug WHERE slug = $1`, [slug])).rows[0];
    const prof = (await c.query(`SELECT id FROM profissional WHERE salao_id = $1 AND nome = 'Ana'`, [salao.salao_id])).rows[0];
    const servico = (await c.query(`SELECT id, duracao_min FROM servico WHERE salao_id = $1 AND nome = 'Corte'`, [salao.salao_id])).rows[0];
    const clienteNome = `Cliente ${randomUUID().slice(0, 8)}`;
    const cliente = (
      await c.query(`INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, $2, $3) RETURNING id`, [salao.salao_id, clienteNome, telefoneUnico().e164])
    ).rows[0];
    const inicio = new Date(Date.now() - randomInt(60, 3000) * 86_400_000);
    inicio.setUTCMinutes(0, 0, 0);
    const reservaId = await inserirReservaDeUmItem(c, {
      salaoId: salao.salao_id,
      profissionalId: prof.id,
      servicoId: servico.id,
      clienteId: cliente.id,
      inicio,
      minutos: servico.duracao_min,
      status: 'concluido',
    });
    return { salaoId: salao.salao_id as string, reservaId, clienteNome };
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
