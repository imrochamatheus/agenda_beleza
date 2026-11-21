// Resultado simulado da reserva na vitrine (sem banco): usa as validações já feitas pela casca.
import { MENSAGENS_RESERVA_PUBLICA } from '@/server/reserva-publica/tipos';
import type { EntradaReservaPublica, ResultadoReservaPublica } from '@/server/reserva-publica/tipos';
import type { ErrosConsentimento } from '@/server/consentimento/tipos';
import type { ErrosCliente } from '@/server/clientes/tipos';
import { lerHorario } from '@/server/reserva-publica/passos';

import { EQUIPE_DEMO, FUSO_DEMO, selecaoDemo } from './dados';

type Validacoes = {
  cliente: { ok: true } | { ok: false; erros: ErrosCliente };
  aceites: { ok: true } | { ok: false; erros: ErrosConsentimento };
};

export function demonstrarReserva(e: EntradaReservaPublica, v: Validacoes): ResultadoReservaPublica {
  const erros = { ...(v.cliente.ok ? {} : v.cliente.erros), ...(v.aceites.ok ? {} : v.aceites.erros) };
  if (Object.keys(erros).length > 0) return { resultado: 'invalido', erros };
  const selecao = selecaoDemo(e.servicoIds);
  const inicio = lerHorario(e.inicio);
  const profissional = EQUIPE_DEMO.find((p) => p.id === e.profissionalId);
  if (selecao === null || inicio === null || profissional === undefined) {
    return { resultado: 'invalido', erros: { servicos: MENSAGENS_RESERVA_PUBLICA.generico } };
  }
  return {
    resultado: 'confirmada',
    repetida: false,
    resumo: {
      servicos: selecao.servicos.map(({ nome, precoCentavos, duracaoMin }) => ({ nome, precoCentavos, duracaoMin })),
      profissionalNome: profissional.nome,
      inicioIso: inicio.toISOString(),
      fuso: FUSO_DEMO,
      totalCentavos: selecao.precoTotalCentavos,
      duracaoTotalMin: selecao.duracaoTotalMin,
    },
  };
}
