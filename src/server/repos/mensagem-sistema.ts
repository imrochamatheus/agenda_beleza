import type { PrismaClient } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';

import { obterPrisma } from './db';
import { ehUuid } from './ids';
import type {
  ConclusaoEnvio,
  ContextoDeEnvio,
  DecisaoDeEnvio,
  EstadoMensagemDTO,
  ResultadoInicio,
  StatusReserva,
  TipoMensagemDTO,
} from './tipos';

// Repositório de SISTEMA das mensagens (D-024 §3.5): usado só pelo worker (handlers e reconciliação).
// Exceção documentada ao escopo prévio, no padrão de token-confirmacao.ts: `localizar` busca por id
// sem salão e devolve só `salaoId` e `estado`; dali em diante tudo recebe o `salaoId` DA LINHA e o
// repete em todo predicado e JOIN. Nunca devolve `parametros`, `provedor_mensagem_id` nem telefone
// (exceto `iniciarEnvio`, que entrega o destinatário ao envio). `atualizado_em` e os demais instantes
// vêm do relógio do chamador (`agora`), nunca de now() do banco. As consultas de reconciliação
// escrevem 'pendente'/'enviando' como LITERAIS, para o índice parcial valer.
// Ordem de travas: mensagem → mensagem_tentativa (T1/T2 e a reconciliação), nunca o contrário.

const ISOLAMENTO = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };

export interface RepoMensagemSistema {
  /** id que não é UUID ou inexistente → null. */
  localizar(id: string): Promise<{ salaoId: string; estado: EstadoMensagemDTO } | null>;
  /**
   * T1, uma transação curta: reivindica `pendente → enviando`, lê o contexto em um comando (sem
   * trava), aplica `decidir` (puro) e então fecha a linha (terminal) ou abre a tentativa (enviar).
   */
  iniciarEnvio(
    salaoId: string,
    id: string,
    agora: Date,
    decidir: (c: ContextoDeEnvio) => DecisaoDeEnvio,
  ): Promise<ResultadoInicio>;
  /**
   * T2: fecha a tentativa e o estado (A-11). `true` = escreveu; `false` = a linha já não estava em
   * estado que aceite o fechamento (nada foi escrito).
   */
  concluirEnvio(
    salaoId: string,
    id: string,
    tentativaId: string,
    r: ConclusaoEnvio,
    agora: Date,
  ): Promise<boolean>;
  /** `pendente` com `atualizado_em < antesDe`, mais antigas primeiro. Só leitura. */
  listarPendentesAntigas(
    antesDe: Date,
    limite: number,
  ): Promise<{ id: string; salaoId: string; reservaId: string; tipo: TipoMensagemDTO; revisao: number }[]>;
  /** `enviando` com `atualizado_em < antesDe` → `falhou/resultado_incerto` + tentativa aberta fechada. Devolve quantas. */
  expirarEnviandoPresas(antesDe: Date, limite: number, agora: Date): Promise<number>;
}

type LinhaContexto = {
  revisao: number;
  status: StatusReserva;
  salao_nome: string;
  fuso: string;
  anonimizada_em: Date | null;
  telefone_e164: string | null;
  consentimento_mensagens: boolean;
  consentimento_convite: boolean;
  /** jsonb: instantes chegam como texto ISO e viram Date abaixo. */
  itens: {
    inicio: string;
    fim: string;
    status: StatusReserva;
    revisao: number;
    servico_nome: string;
    profissional_nome: string;
  }[];
};

export function criarRepoMensagemSistema(db?: PrismaClient): RepoMensagemSistema {
  const cliente = () => db ?? obterPrisma();
  return {
    async localizar(id) {
      if (!ehUuid(id)) {
        return null;
      }
      const [linha] = await cliente().$queryRaw<{ salao_id: string; estado: EstadoMensagemDTO }[]>`
        SELECT salao_id::text AS salao_id, estado::text AS estado FROM mensagem WHERE id = ${id}::uuid`;
      return linha ? { salaoId: linha.salao_id, estado: linha.estado } : null;
    },

    async iniciarEnvio(salaoId, id, agora, decidir) {
      return cliente().$transaction(async (tx): Promise<ResultadoInicio> => {
        // (1) Reivindicação atômica: só `pendente` (A-3). Trava a linha de `mensagem`.
        const reivindicadas = await tx.$queryRaw<{ tipo: TipoMensagemDTO; revisao: number; reserva_id: string }[]>`
          UPDATE mensagem
             SET estado = 'enviando', atualizado_em = ${agora}::timestamptz
           WHERE id = ${id}::uuid AND salao_id = ${salaoId}::uuid AND estado = 'pendente'
          RETURNING tipo::text AS tipo, revisao, reserva_id::text AS reserva_id`;
        if (reivindicadas.length === 0) {
          return { resultado: 'nao_reivindicada' };
        }
        const m = reivindicadas[0];

        // (2) Contexto num só comando, sem travas (A-5). D-050: os itens (nomes atuais de serviço e
        // profissional) por (inicio, id), para a vigência por item e os parâmetros montados no envio.
        const [l] = await tx.$queryRaw<LinhaContexto[]>`
          SELECT r.revisao, r.status::text AS status, s.nome AS salao_nome, s.fuso,
                 c.anonimizada_em, c.telefone_e164,
                 COALESCE(k.mensagens, false) AS consentimento_mensagens,
                 COALESCE(k.convite, false) AS consentimento_convite,
                 COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'inicio', i.inicio, 'fim', i.fim, 'status', i.status::text, 'revisao', i.revisao,
                            'servico_nome', sv.nome, 'profissional_nome', p.nome)
                          ORDER BY i.inicio, i.id)
                     FROM reserva_item i
                     JOIN servico sv ON sv.salao_id = i.salao_id AND sv.id = i.servico_id
                     JOIN profissional p ON p.salao_id = i.salao_id AND p.id = i.profissional_id
                    WHERE i.salao_id = r.salao_id AND i.reserva_id = r.id
                 ), '[]'::jsonb) AS itens
            FROM reserva r
            JOIN salao s ON s.id = r.salao_id
            JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
            LEFT JOIN LATERAL (
              SELECT bool_or(k.finalidade = 'mensagens_reserva') AS mensagens,
                     bool_or(k.finalidade = 'convite_avaliacao') AS convite
                FROM consentimento k
               WHERE k.salao_id = c.salao_id AND k.cliente_id = c.id
            ) k ON true
           WHERE r.id = ${m.reserva_id}::uuid AND r.salao_id = ${salaoId}::uuid`;
        const contexto: ContextoDeEnvio = {
          tipo: m.tipo,
          mensagemRevisao: m.revisao,
          reservaId: m.reserva_id,
          reserva: { revisao: l.revisao, status: l.status },
          itens: l.itens.map((i) => ({
            inicio: new Date(i.inicio),
            fim: new Date(i.fim),
            status: i.status,
            revisao: i.revisao,
            servicoNome: i.servico_nome,
            profissionalNome: i.profissional_nome,
          })),
          salaoNome: l.salao_nome,
          fuso: l.fuso,
          clienteAnonimizada: l.anonimizada_em !== null,
          telefone: l.telefone_e164,
          consentimentoMensagens: l.consentimento_mensagens,
          consentimentoConvite: l.consentimento_convite,
        };

        // (3) Decisão pura.
        const decisao = decidir(contexto);

        // (4a) Terminal: fecha a linha aqui, sem tentativa (A-4), e anula o que é pessoal.
        if (decisao.acao === 'terminal') {
          await tx.$executeRaw`
            UPDATE mensagem
               SET estado = ${decisao.estado}::estado_mensagem, erro_codigo = ${decisao.erroCodigo}::text,
                   destinatario_e164 = NULL, parametros = NULL, atualizado_em = ${agora}::timestamptz
             WHERE id = ${id}::uuid AND salao_id = ${salaoId}::uuid`;
          return {
            resultado: 'terminal',
            estado: decisao.estado,
            erroCodigo: decisao.erroCodigo,
            tipo: m.tipo,
            revisao: m.revisao,
          };
        }

        // (4b) Enviar: abre a tentativa (a linha de `mensagem` já está travada: numeração sem corrida).
        const telefone = contexto.telefone;
        if (telefone === null) {
          // decidir() já trata telefone nulo como terminal; isto só protege um decisor mal escrito.
          throw new Error('decisão de envio sem destinatário');
        }
        const [tentativa] = await tx.$queryRaw<{ id: string; numero: number }[]>`
          INSERT INTO mensagem_tentativa (mensagem_id, numero, iniciada_em)
          SELECT ${id}::uuid, COALESCE(MAX(numero), 0) + 1, ${agora}::timestamptz
            FROM mensagem_tentativa WHERE mensagem_id = ${id}::uuid
          RETURNING id::text AS id, numero`;
        await tx.$executeRaw`
          UPDATE mensagem SET destinatario_e164 = ${telefone}::text
           WHERE id = ${id}::uuid AND salao_id = ${salaoId}::uuid`;
        return {
          resultado: 'enviar',
          tentativaId: tentativa.id,
          numero: tentativa.numero,
          destinatarioE164: telefone,
          tipo: m.tipo,
          revisao: m.revisao,
          reservaId: m.reserva_id,
          contexto,
        };
      }, ISOLAMENTO);
    },

    async concluirEnvio(salaoId, id, tentativaId, r, agora) {
      return cliente().$transaction(async (tx) => {
        if (r.resultado === 'sucesso') {
          // A-11: o sucesso vence a reconciliação (`falhou/resultado_incerto` → `enviada`).
          const escritas = await tx.$executeRaw`
            UPDATE mensagem
               SET estado = 'enviada', provedor_mensagem_id = ${r.provedorMensagemId}::text,
                   enviada_em = ${agora}::timestamptz, erro_codigo = NULL, atualizado_em = ${agora}::timestamptz
             WHERE id = ${id}::uuid AND salao_id = ${salaoId}::uuid
               AND (estado = 'enviando' OR (estado = 'falhou' AND erro_codigo = 'resultado_incerto'))`;
          if (escritas === 0) {
            return false;
          }
          await tx.$executeRaw`
            UPDATE mensagem_tentativa
               SET resultado = 'sucesso', erro_codigo = NULL, erro_detalhe = NULL,
                   finalizada_em = ${agora}::timestamptz
             WHERE id = ${tentativaId}::uuid AND mensagem_id = ${id}::uuid
               AND (resultado IS NULL OR erro_codigo = 'resultado_incerto')`;
          return true;
        }
        const escritas = await tx.$executeRaw`
          UPDATE mensagem
             SET estado = ${r.estadoFinal}::estado_mensagem, erro_codigo = ${r.erroCodigo}::text,
                 atualizado_em = ${agora}::timestamptz
           WHERE id = ${id}::uuid AND salao_id = ${salaoId}::uuid AND estado = 'enviando'`;
        if (escritas === 0) {
          return false;
        }
        await tx.$executeRaw`
          UPDATE mensagem_tentativa
             SET resultado = 'falha', erro_codigo = ${r.erroCodigo}::text, erro_detalhe = ${r.erroDetalhe}::text,
                 finalizada_em = ${agora}::timestamptz
           WHERE id = ${tentativaId}::uuid AND mensagem_id = ${id}::uuid AND resultado IS NULL`;
        return true;
      }, ISOLAMENTO);
    },

    async listarPendentesAntigas(antesDe, limite) {
      const linhas = await cliente().$queryRaw<
        { id: string; salao_id: string; reserva_id: string; tipo: TipoMensagemDTO; revisao: number }[]
      >`
        SELECT id::text AS id, salao_id::text AS salao_id, reserva_id::text AS reserva_id,
               tipo::text AS tipo, revisao
          FROM mensagem
         WHERE estado = 'pendente' AND atualizado_em < ${antesDe}::timestamptz
         ORDER BY atualizado_em, id
         LIMIT ${limite}::int`;
      return linhas.map((l) => ({
        id: l.id,
        salaoId: l.salao_id,
        reservaId: l.reserva_id,
        tipo: l.tipo,
        revisao: l.revisao,
      }));
    },

    async expirarEnviandoPresas(antesDe, limite, agora) {
      return cliente().$transaction(async (tx) => {
        const presas = await tx.$queryRaw<{ id: string }[]>`
          WITH presas AS (
            SELECT id FROM mensagem
             WHERE estado = 'enviando' AND atualizado_em < ${antesDe}::timestamptz
             ORDER BY atualizado_em, id
             LIMIT ${limite}::int
             FOR UPDATE SKIP LOCKED
          )
          UPDATE mensagem m
             SET estado = 'falhou', erro_codigo = 'resultado_incerto', atualizado_em = ${agora}::timestamptz
            FROM presas
           WHERE m.id = presas.id
          RETURNING m.id::text AS id`;
        if (presas.length > 0) {
          const ids = presas.map((p) => p.id);
          await tx.$executeRaw`
            UPDATE mensagem_tentativa
               SET resultado = 'falha', erro_codigo = 'resultado_incerto', erro_detalhe = 'resultado incerto',
                   finalizada_em = ${agora}::timestamptz
             WHERE resultado IS NULL AND mensagem_id = ANY(${ids}::uuid[])`;
        }
        return presas.length;
      }, ISOLAMENTO);
    },
  };
}

/** Repositório de sistema ligado ao cliente padrão (DATABASE_URL lida na chamada). */
export function repoMensagemSistema(): RepoMensagemSistema {
  return criarRepoMensagemSistema();
}
