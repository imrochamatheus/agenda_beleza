import { formatarData, formatarHora, formatarLista } from '@/lib/format';
import type { ContextoDeEnvio } from '@/server/repos/tipos';

import type { TipoMensagem } from './tipos';

// Conteúdo das mensagens por tipo (D-024 §3.3; D-050 §3.7, RN-27/RN-29). Os nomes são o contrato com o
// adaptador (`ORDEM_PARAMETROS` em integrations/whatsapp/mapeamento.ts). Puro: o fuso é o do salão no
// momento do envio e os itens são os lidos no envio (nomes atuais de serviço e profissional).

export type ItemDosParametros = Pick<
  ContextoDeEnvio['itens'][number],
  'inicio' | 'status' | 'revisao' | 'servicoNome' | 'profissionalNome'
>;

export type DadosDeParametros = {
  salaoNome: string;
  fuso: string;
  itens: readonly ItemDosParametros[];
  /** Revisão da mensagem: seleciona os itens de `remarcacao`/`cancelamento`. */
  revisao: number;
};

/** Sem quebra de linha nem tabulação (RN-27): o modelo de WhatsApp não aceita. */
const umaLinha = (texto: string): string => texto.replace(/[\r\n\t]+/g, ' ');

/** Ordem de início; estável para o mesmo instante (o repositório já entrega por (inicio, id)). */
const porInicio = <T extends { inicio: Date }>(itens: readonly T[]): T[] =>
  [...itens].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

/** Nomes distintos, na ordem da primeira ocorrência. */
const distintos = (nomes: readonly string[]): string[] => [...new Set(nomes)];

function exigirItens<T>(itens: T[], tipo: TipoMensagem): T[] {
  if (itens.length === 0) {
    // A vigência (conferirVigencia) garante pelo menos um item antes do envio; isto só protege o contrato.
    throw new RangeError(`parâmetros de ${tipo} sem itens`);
  }
  return itens;
}

/**
 * - `confirmacao` → `{ salao, data, itens }`: itens não cancelados por início, "09:00 Escova com Ana; 10:00 …"
 *   numa linha só; `data` do primeiro deles (a reserva tem data local única, RN-8).
 * - `remarcacao` → `{ salao, servicos, profissional, data, horario }` dos itens com `revisao = m.revisao` e
 *   `confirmado` (um item; mensagens antigas da reserva migrada podem citar vários do mesmo profissional).
 * - `cancelamento` → `{ salao, servicos, data, horario }` dos itens com `revisao = m.revisao` e `cancelado`
 *   ("cancelar todos" cita todos os cancelados juntos), `data`/`horario` do primeiro.
 * Seleção vazia → RangeError (não acontece depois de `conferirVigencia`).
 */
export function montarParametros(
  tipo: Exclude<TipoMensagem, 'convite_avaliacao'>,
  d: DadosDeParametros,
): Record<string, string> {
  const salao = umaLinha(d.salaoNome);
  if (tipo === 'confirmacao') {
    const ativos = exigirItens(
      porInicio(d.itens.filter((i) => i.status !== 'cancelado')),
      tipo,
    );
    return {
      salao,
      data: formatarData(ativos[0].inicio, d.fuso),
      itens: umaLinha(
        ativos
          .map((i) => `${formatarHora(i.inicio, d.fuso)} ${i.servicoNome} com ${i.profissionalNome}`)
          .join('; '),
      ),
    };
  }
  const alvo = exigirItens(
    porInicio(
      d.itens.filter(
        (i) => i.revisao === d.revisao && i.status === (tipo === 'remarcacao' ? 'confirmado' : 'cancelado'),
      ),
    ),
    tipo,
  );
  const base = {
    salao,
    servicos: umaLinha(formatarLista(alvo.map((i) => i.servicoNome))),
    data: formatarData(alvo[0].inicio, d.fuso),
    horario: formatarHora(alvo[0].inicio, d.fuso),
  };
  if (tipo === 'cancelamento') return base;
  return {
    salao: base.salao,
    servicos: base.servicos,
    profissional: umaLinha(formatarLista(distintos(alvo.map((i) => i.profissionalNome)))),
    data: base.data,
    horario: base.horario,
  };
}

/** `convite_avaliacao`: salao e link (o link só existe em memória até a porta, RN-14). */
export function montarParametrosConvite(salaoNome: string, link: string): Record<string, string> {
  return { salao: salaoNome, link };
}
