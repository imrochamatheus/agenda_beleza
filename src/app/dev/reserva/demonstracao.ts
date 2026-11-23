// Resultado simulado da reserva na vitrine (sem banco): usa as validações já feitas pela casca.
import { MENSAGENS_RESERVA_PUBLICA } from '@/server/reserva-publica/tipos';
import type { EntradaReservaPublica, ResultadoReservaPublica, ResumoConfirmacao } from '@/server/reserva-publica/tipos';
import type { ErrosConsentimento } from '@/server/consentimento/tipos';
import type { ErrosCliente } from '@/server/clientes/tipos';
import { chaveDeData, lerHorario, lerServicoIds } from '@/server/reserva-publica/passos';
import { partesLocais } from '@/server/tempo/fuso';

import { EQUIPE_DEMO, FUSO_DEMO, SERVICOS_DEMO } from './dados';

type Validacoes = {
  cliente: { ok: true } | { ok: false; erros: ErrosCliente };
  aceites: { ok: true } | { ok: false; erros: ErrosConsentimento };
};

const MS_MIN = 60_000;

/** Confirmação simulada com um item por serviço (D-050): cada item com profissional e horário próprios. */
export function demonstrarReserva(e: EntradaReservaPublica, v: Validacoes): ResultadoReservaPublica {
  const erros = { ...(v.cliente.ok ? {} : v.cliente.erros), ...(v.aceites.ok ? {} : v.aceites.erros) };
  if (Object.keys(erros).length > 0) return { resultado: 'invalido', erros };
  const invalido: ResultadoReservaPublica = { resultado: 'invalido', erros: { itens: MENSAGENS_RESERVA_PUBLICA.generico } };
  const s = lerServicoIds(e.servicoIds);
  if (s === null || e.itens.length !== s.length) return invalido;
  const itens: ResumoConfirmacao['itens'] = [];
  for (const [k, x] of e.itens.entries()) {
    const servico = SERVICOS_DEMO.find((sv) => sv.id === s[k] && x.servicoId.toLowerCase() === s[k]);
    const profissional = EQUIPE_DEMO.find((p) => p.id === x.profissionalId);
    const inicio = lerHorario(x.inicio);
    if (servico === undefined || profissional === undefined || inicio === null) return invalido;
    itens.push({
      servicoNome: servico.nome,
      profissionalNome: profissional.nome,
      inicioIso: inicio.toISOString(),
      fimIso: new Date(inicio.getTime() + servico.duracaoMin * MS_MIN).toISOString(),
      precoCentavos: servico.precoCentavos,
      duracaoMin: servico.duracaoMin,
    });
  }
  itens.sort((a, b) => (a.inicioIso < b.inicioIso ? -1 : a.inicioIso > b.inicioIso ? 1 : 0));
  return {
    resultado: 'confirmada',
    repetida: false,
    resumo: {
      fuso: FUSO_DEMO,
      data: chaveDeData(partesLocais(new Date(itens[0].inicioIso), FUSO_DEMO).data),
      itens,
      totalCentavos: itens.reduce((t, i) => t + i.precoCentavos, 0),
    },
  };
}
