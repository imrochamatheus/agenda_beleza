import type { Prisma, PrismaClient } from '@/generated/prisma/client';

import { obterPrisma } from './db';

// Repositório de PLATAFORMA do WhatsApp simulado (D-007 §3.10; contrato e SQL aprovados em
// docs/demandas/D-007/dba.md §3 e §4.1). Sem ContextoEscopado (as tabelas sim_whatsapp_* não
// pertencem a um salão; exceção documentada, como sessao.ts). Recebe só um CLIENTE, nunca a
// transação do chamador (RN-15). Sem cliente, usa `obterPrisma()` resolvido em cada chamada.
// Não deduplica por chave de idempotência (RN-19): só registra.

export type TipoFalhaSimulada = 'temporaria' | 'permanente';

export type LinhaChamada = {
  id: string;
  destinatario: string;
  modelo: string;
  parametros: Record<string, string>;
  chaveIdempotencia: string;
  resultado: 'sucesso' | 'falha';
  tipoFalha: TipoFalhaSimulada | null;
  provedorMensagemId: string | null;
  criadoEm: Date;
};

/** Mesmos campos de `EnvioModelo` (porta do WhatsApp), com `modelo` livre (A-2: coluna `text`). */
export type EntradaChamada = {
  destinatarioE164: string;
  modelo: string;
  parametros: Readonly<Record<string, string>>;
  chaveIdempotencia: string;
  /** Reprovada em `validarEnvioModelo`: registrada como falha permanente SEM consumir falha forçada. */
  invalida: boolean;
};

export type ResultadoChamada =
  | { resultado: 'sucesso'; provedorMensagemId: string }
  | { resultado: 'falha'; tipo: TipoFalhaSimulada };

export interface RepoSimWhatsApp {
  /** As próximas `n` chamadas (n inteiro ≥ 1) falham com o tipo, na ordem de criação. */
  forcarFalhas(n: number, tipo: TipoFalhaSimulada): Promise<void>;
  /**
   * Uma instrução: consome no máximo 1 falha forçada (SKIP LOCKED) e insere a chamada com o
   * resultado. `gerarId` dá o `provedor_mensagem_id` (usado só no sucesso).
   */
  registrarChamada(e: EntradaChamada, gerarId: () => string): Promise<ResultadoChamada>;
  /** Na ordem de registro. */
  listarChamadas(filtro?: { chaveIdempotencia?: string }): Promise<LinhaChamada[]>;
}

const TIPOS_FALHA: readonly string[] = ['temporaria', 'permanente'];

type Registrada = { resultado: 'sucesso' | 'falha'; tipo_falha: TipoFalhaSimulada | null; provedor_mensagem_id: string | null };

/** Uma chamada inválida pode trazer qualquer coisa em runtime (JS): grava texto, sem lançar no INSERT. */
function comoTexto(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

export function repoSimWhatsApp(db?: PrismaClient): RepoSimWhatsApp {
  const cliente = () => db ?? obterPrisma();
  return {
    async forcarFalhas(n, tipo) {
      if (!Number.isInteger(n) || n < 1) {
        throw new RangeError('forcarFalhas: n deve ser um inteiro maior ou igual a 1.');
      }
      if (!TIPOS_FALHA.includes(tipo)) {
        throw new RangeError('forcarFalhas: tipo deve ser "temporaria" ou "permanente".');
      }
      await cliente().$executeRaw`
        INSERT INTO sim_whatsapp_falha_forcada (tipo)
        SELECT ${tipo}::sim_whatsapp_tipo_falha FROM generate_series(1, ${n}::int)`;
    },

    async registrarChamada(e, gerarId) {
      const destinatario = comoTexto(e.destinatarioE164);
      const modelo = comoTexto(e.modelo);
      const chave = comoTexto(e.chaveIdempotencia);
      const parametros = JSON.stringify(e.parametros ?? {});

      if (e.invalida) {
        await cliente().$executeRaw`
          INSERT INTO sim_whatsapp_chamada
            (destinatario, modelo, parametros, chave_idempotencia, resultado, tipo_falha, provedor_mensagem_id)
          VALUES (${destinatario}::text, ${modelo}::text, ${parametros}::jsonb, ${chave}::text,
                  'falha'::resultado_tentativa, 'permanente'::sim_whatsapp_tipo_falha, NULL)`;
        return { resultado: 'falha', tipo: 'permanente' };
      }

      const provedorMensagemId = gerarId();
      const [linha] = await cliente().$queryRaw<Registrada[]>`
        WITH falha AS (
          DELETE FROM sim_whatsapp_falha_forcada
          WHERE id = (SELECT id FROM sim_whatsapp_falha_forcada
                      ORDER BY criado_em, id LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING tipo
        )
        INSERT INTO sim_whatsapp_chamada
          (destinatario, modelo, parametros, chave_idempotencia, resultado, tipo_falha, provedor_mensagem_id)
        SELECT ${destinatario}::text, ${modelo}::text, ${parametros}::jsonb, ${chave}::text,
               CASE WHEN f.tipo IS NULL THEN 'sucesso' ELSE 'falha' END::resultado_tentativa,
               f.tipo,
               CASE WHEN f.tipo IS NULL THEN ${provedorMensagemId}::text END
        FROM (SELECT 1) AS um LEFT JOIN falha AS f ON true
        RETURNING resultado::text AS resultado, tipo_falha::text AS tipo_falha, provedor_mensagem_id`;

      if (linha.resultado === 'sucesso') {
        return { resultado: 'sucesso', provedorMensagemId: linha.provedor_mensagem_id as string };
      }
      return { resultado: 'falha', tipo: linha.tipo_falha as TipoFalhaSimulada };
    },

    async listarChamadas(filtro = {}) {
      const where: Prisma.SimWhatsappChamadaWhereInput =
        filtro.chaveIdempotencia === undefined ? {} : { chaveIdempotencia: filtro.chaveIdempotencia };
      const linhas = await cliente().simWhatsappChamada.findMany({
        where,
        orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      });
      return linhas.map((l) => ({
        id: l.id,
        destinatario: l.destinatario,
        modelo: l.modelo,
        parametros: l.parametros as Record<string, string>,
        chaveIdempotencia: l.chaveIdempotencia,
        resultado: l.resultado,
        tipoFalha: l.tipoFalha,
        provedorMensagemId: l.provedorMensagemId,
        criadoEm: l.criadoEm,
      }));
    },
  };
}
