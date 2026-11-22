import type pg from 'pg';

import { obterPrisma } from '@/server/repos/db';

import { criarAssinaturaEm } from './assinatura';
import type { EstadoAssinaturaTeste } from './assinatura';

// Apoio dos testes da política de somente leitura (D-038): põe um salão numa situação da tabela única
// (assinatura, suspensão manual ou sem linha) e fotografa o que a política não pode deixar mudar.

export type SituacaoDeTeste = EstadoAssinaturaTeste | 'manual' | 'sem_assinatura' | 'cancelada_vencida';

/** Relógio dos testes que dependem de limite de prazo (cancelada vigente x vencida). */
export const AGORA_POLITICA = new Date();
const DIA_MS = 24 * 60 * 60 * 1000;

/** Aplica a situação ao salão (que a fábrica criou sem assinatura). Idempotente por salão. */
export async function aplicarSituacao(salaoId: string, situacao: SituacaoDeTeste): Promise<void> {
  const futuro = new Date(AGORA_POLITICA.getTime() + 30 * DIA_MS);
  switch (situacao) {
    case 'sem_assinatura':
      return;
    case 'manual':
      await obterPrisma().salao.update({ where: { id: salaoId }, data: { suspensoManualEm: new Date('2026-01-01T00:00:00Z') } });
      return;
    case 'em_carencia':
      await criarAssinaturaEm(salaoId, 'em_carencia', { primeiraFalhaEm: AGORA_POLITICA, carenciaAte: futuro });
      return;
    case 'cancelada':
      await criarAssinaturaEm(salaoId, 'cancelada', { canceladaEm: AGORA_POLITICA, acessoAte: futuro });
      return;
    case 'cancelada_vencida':
      await criarAssinaturaEm(salaoId, 'cancelada', { canceladaEm: new Date('2020-01-01T00:00:00Z'), acessoAte: new Date('2020-02-01T00:00:00Z') });
      return;
    default:
      await criarAssinaturaEm(salaoId, situacao);
  }
}

/** Capacidades que a tabela nega por situação (conferidas em `tabela` do teste, não aqui). */
export const SOMENTE_LEITURA: readonly SituacaoDeTeste[] = ['suspensa', 'encerrada', 'manual', 'cancelada_vencida'];

const TABELAS_COM_SALAO = [
  'servico', 'servico_profissional', 'profissional', 'jornada', 'bloqueio', 'reserva', 'reserva_item', 'cliente',
  'salao_foto', 'salao_funcionamento', 'mensagem', 'consentimento', 'salao_slug', 'usuario',
];

/** Impressão digital (md5 por tabela) de tudo que pertence ao salão: igual antes e depois = nada mudou. */
export async function impressaoDoSalao(c: pg.Client, salaoId: string): Promise<Record<string, string>> {
  const r: Record<string, string> = {};
  const lista = await c.query<{ h: string | null }>(
    `SELECT md5(coalesce(string_agg(to_jsonb(s)::text, '|' ORDER BY to_jsonb(s)::text), '')) AS h FROM salao s WHERE id = $1`,
    [salaoId],
  );
  r.salao = lista.rows[0].h ?? '';
  for (const t of TABELAS_COM_SALAO) {
    const q = await c.query<{ h: string | null }>(
      `SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY to_jsonb(t)::text), '')) AS h FROM ${t} t WHERE salao_id = $1`,
      [salaoId],
    );
    r[t] = q.rows[0].h ?? '';
  }
  return r;
}
