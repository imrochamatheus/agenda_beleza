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

export const TEXTO_FALHA_NA_GRADE = 'Falha ao enviar mensagem';

/**
 * Marca de falha de mensagem vigente (D-043 RN-11): triângulo SVG (forma, não só cor) e o texto. Na grade do
 * dia o texto é só para leitor de tela e o triângulo fica sobreposto no canto, sem mudar o tamanho do
 * bloco; na lista da semana o texto é visível. Fica DENTRO do link: nenhuma parada de tabulação nova.
 */
export function MarcaDeFalha({ variante }: { variante: 'grade' | 'lista' }) {
  const triangulo = (
    <svg className={estilos.marcaIcone} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path d="M9 1.5 17 16H1z" className={estilos.marcaForma} />
      <path d="M9 6.5v4.5" className={estilos.marcaSinal} />
      <circle cx="9" cy="13.4" r="0.9" className={estilos.marcaPonto} />
    </svg>
  );
  if (variante === 'grade') {
    return (
      <span className={estilos.marcaFalha}>
        {triangulo}
        <span className={estilos.somenteLeitor}>{TEXTO_FALHA_NA_GRADE}. </span>
      </span>
    );
  }
  return (
    <span className={estilos.linhaFalha}>
      <span className={estilos.marcaLista}>
        {triangulo}
        {TEXTO_FALHA_NA_GRADE}
      </span>
    </span>
  );
}

export function EventoDeReserva({ reserva, faixa, href, estiloExtra }: PropsReserva) {
  const classe = `${estilos.evento} ${estilos[reserva.status]}${reserva.temFalhaDeMensagem ? ` ${estilos.comFalha}` : ''}`;
  return (
    <a className={classe} href={href} style={estiloExtra}>
      {reserva.temFalhaDeMensagem ? <MarcaDeFalha variante="grade" /> : null}
      <ConteudoDaReserva reserva={reserva} faixa={faixa} />
    </a>
  );
}
