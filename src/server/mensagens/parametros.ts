import { formatarData, formatarHora, formatarLista } from '@/lib/format';

import type { TipoMensagem } from './tipos';

// Conteúdo das mensagens por tipo (D-024 §3.3, A-12, RN-11). Os nomes são o contrato com a E7.2,
// que os mapeia à posição de cada template. Puro: o fuso vem do salão no momento do envio.

export type DadosDeParametros = {
  salaoNome: string;
  fuso: string;
  inicio: Date;
  servicos: string[];
  profissionalNome: string | null;
};

/** `confirmacao`/`remarcacao`: salao, servicos, profissional, data, horario; `cancelamento`: sem profissional. */
export function montarParametros(
  tipo: Exclude<TipoMensagem, 'convite_avaliacao'>,
  d: DadosDeParametros,
): Record<string, string> {
  const base = {
    salao: d.salaoNome,
    servicos: formatarLista(d.servicos),
    data: formatarData(d.inicio, d.fuso),
    horario: formatarHora(d.inicio, d.fuso),
  };
  if (tipo === 'cancelamento') return base;
  return {
    salao: base.salao,
    servicos: base.servicos,
    profissional: d.profissionalNome ?? '',
    data: base.data,
    horario: base.horario,
  };
}

/** `convite_avaliacao`: salao e link (o link só existe em memória até a porta, RN-14). */
export function montarParametrosConvite(salaoNome: string, link: string): Record<string, string> {
  return { salao: salaoNome, link };
}
