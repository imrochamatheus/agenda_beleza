import type { Finalidade } from '@/config/termos';
import type { ContextoEscopado } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import type { ConsentimentoDTO, OrigemConsentimentoDTO } from './tipos';
import type { Executor } from './transacao';

// Consentimento por finalidade (D-023). Ordem canônica de travas (ver repos/servico.ts): salao →
// profissional(is) → serviço(s) → CLIENTE → CONSENTIMENTO → reserva/reserva_item. `registrar` roda
// no executor do chamador (a transação da reserva, RN-9) em dois comandos: (1) SELECT … FOR KEY SHARE
// na cliente (compatível com o NO KEY UPDATE do upsert e com outros registros; conflita com o FOR
// UPDATE da edição de telefone e da anonimização, que esperam a transação curta da reserva ou, se
// vierem antes, são vistas pela releitura em READ COMMITTED); (2) INSERT. Sem UNIQUE: nenhum 23505.
// O marcador "FOR KEY SHARE" é procurado em pg_stat_activity pelos testes de concorrência.

type LinhaConsentimento = {
  id: string;
  finalidade: Finalidade;
  origem: OrigemConsentimentoDTO;
  versao_termos: string;
  criado_em: Date;
};

const paraDTO = (l: LinhaConsentimento): ConsentimentoDTO => ({
  id: l.id,
  finalidade: l.finalidade,
  origem: l.origem,
  versaoTermos: l.versao_termos,
  criadoEm: l.criado_em,
});

export interface RepoConsentimento {
  /**
   * A-4: FOR KEY SHARE na cliente; NaoEncontrado se de outro salão, inexistente, id não UUID ou
   * anonimizada (sem distinguir). Não valida origem × finalidade (o CHECK do banco é a última defesa).
   */
  registrar(
    ctx: ContextoEscopado,
    v: { clienteId: string; finalidade: Finalidade; origem: OrigemConsentimentoDTO; versaoTermos: string; criadoEm: Date },
  ): Promise<ConsentimentoDTO>;
  /** A-9: null se anonimizada ou sem aceite; NaoEncontrado se a cliente não for do salão. Sem trava. */
  vigente(ctx: ContextoEscopado, clienteId: string, finalidade: Finalidade): Promise<ConsentimentoDTO | null>;
}

export function criarRepoConsentimento(db: Executor): RepoConsentimento {
  return {
    async registrar(ctx, v) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(v.clienteId)) {
        throw new NaoEncontrado();
      }
      const cliente = await db.$queryRaw<{ anonimizada_em: Date | null }[]>`
        SELECT anonimizada_em FROM cliente
        WHERE id = ${v.clienteId}::uuid AND salao_id = ${salaoId}::uuid
        FOR KEY SHARE`;
      if (cliente.length === 0 || cliente[0].anonimizada_em !== null) {
        throw new NaoEncontrado();
      }
      const linhas = await db.$queryRaw<LinhaConsentimento[]>`
        INSERT INTO consentimento (salao_id, cliente_id, finalidade, origem, versao_termos, criado_em)
        VALUES (${salaoId}::uuid, ${v.clienteId}::uuid, ${v.finalidade}::finalidade_consentimento,
                ${v.origem}::origem_consentimento, ${v.versaoTermos}, ${v.criadoEm})
        RETURNING id, finalidade::text AS finalidade, origem::text AS origem, versao_termos, criado_em`;
      return paraDTO(linhas[0]);
    },

    async vigente(ctx, clienteId, finalidade) {
      const salaoId = exigirEscopo(ctx);
      if (!ehUuid(clienteId)) {
        throw new NaoEncontrado();
      }
      const linhas = await db.$queryRaw<(Partial<LinhaConsentimento> & { anonimizada_em: Date | null })[]>`
        SELECT c.anonimizada_em, k.id, k.finalidade::text AS finalidade, k.origem::text AS origem,
               k.versao_termos, k.criado_em
        FROM cliente c
        LEFT JOIN LATERAL (
          SELECT id, finalidade, origem, versao_termos, criado_em
          FROM consentimento k
          WHERE k.salao_id = c.salao_id AND k.cliente_id = c.id
            AND k.finalidade = ${finalidade}::finalidade_consentimento
          ORDER BY k.criado_em DESC, k.id DESC
          LIMIT 1
        ) k ON true
        WHERE c.id = ${clienteId}::uuid AND c.salao_id = ${salaoId}::uuid`;
      if (linhas.length === 0) {
        throw new NaoEncontrado();
      }
      const l = linhas[0];
      if (l.anonimizada_em !== null || l.id == null) {
        return null;
      }
      return paraDTO(l as LinhaConsentimento);
    },
  };
}
