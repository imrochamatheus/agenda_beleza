import { formatarFaixaDeMinutos } from '@/lib/format';
import { rotuloDoStatus } from '@/server/agenda/rotulos';
import { MENSAGENS_AGENDA } from '@/server/agenda/tipos';
import type { BloqueioDaAgenda, FaixaDoDia, ReservaDaAgenda } from '@/server/agenda/tipos';
import { formatarLista } from '@/lib/format';
import { TEXTO_CLIENTE_REMOVIDA } from '@/server/clientes/tipos';

import estilos from './Agenda.module.css';

/** Nome da cliente na grade: anonimizada → "cliente removida" (importado, nunca copiado). Sem telefone (CA-17). */
export const nomeDaCliente = (r: ReservaDaAgenda): string => r.clienteNome ?? TEXTO_CLIENTE_REMOVIDA;

export const rotuloDoBloqueio = (b: BloqueioDaAgenda): string => {
  const base = b.profissionalId === null ? MENSAGENS_AGENDA.bloqueioDoSalao : MENSAGENS_AGENDA.bloqueio;
  return b.motivo === null || b.motivo === '' ? base : `${base}: ${b.motivo}`;
};

type PropsReserva = { reserva: ReservaDaAgenda; faixa: FaixaDoDia; href: string; estiloExtra?: React.CSSProperties };

/** Conteúdo comum da reserva (grade e lista): horário, cliente, serviços, status textual e encaixe. */
export function ConteudoDaReserva({ reserva, faixa }: { reserva: ReservaDaAgenda; faixa: FaixaDoDia }) {
  return (
    <>
      <strong>{formatarFaixaDeMinutos(faixa.inicioMin, faixa.fimMin)}</strong> {nomeDaCliente(reserva)}
      {reserva.itens.length > 0 ? <> · {formatarLista(reserva.itens.map((i) => i.nome))}</> : null} ·{' '}
      {rotuloDoStatus(reserva.status)}
      {reserva.encaixe ? <> · {MENSAGENS_AGENDA.encaixe}</> : null}
    </>
  );
}

export function EventoDeReserva({ reserva, faixa, href, estiloExtra }: PropsReserva) {
  return (
    <a className={`${estilos.evento} ${estilos[reserva.status]}`} href={href} style={estiloExtra}>
      <ConteudoDaReserva reserva={reserva} faixa={faixa} />
    </a>
  );
}
