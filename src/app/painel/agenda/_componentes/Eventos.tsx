import { formatarFaixaDeMinutos } from '@/lib/format';
import { rotuloDoStatusDoItem } from '@/server/agenda/rotulos';
import { MENSAGENS_AGENDA } from '@/server/agenda/tipos';
import type { BlocoDaAgenda, BloqueioDaAgenda, FaixaDoDia } from '@/server/agenda/tipos';
import { TEXTO_CLIENTE_REMOVIDA } from '@/server/clientes/tipos';

import estilos from './Agenda.module.css';
import { idDoItem } from './roteiro';

/** Nome da cliente na grade: anonimizada → "cliente removida" (importado, nunca copiado). Sem telefone (CA-17). */
export const nomeDaCliente = (b: Pick<BlocoDaAgenda, 'clienteNome'>): string => b.clienteNome ?? TEXTO_CLIENTE_REMOVIDA;

/** Link do bloco: o detalhe da reserva, aberto na parada do item (`#item-<id>`), com e sem JavaScript. */
export const hrefDoBloco = (hrefReserva: (id: string) => string, b: Pick<BlocoDaAgenda, 'reservaId' | 'itemId'>): string =>
  `${hrefReserva(b.reservaId)}#${idDoItem(b.itemId)}`;

export const rotuloDoBloqueio = (b: BloqueioDaAgenda): string => {
  const base = b.profissionalId === null ? MENSAGENS_AGENDA.bloqueioDoSalao : MENSAGENS_AGENDA.bloqueio;
  return b.motivo === null || b.motivo === '' ? base : `${base}: ${b.motivo}`;
};

type PropsBloco = { bloco: BlocoDaAgenda; faixa: FaixaDoDia; href: string; estiloExtra?: React.CSSProperties };

/**
 * Conteúdo comum do bloco (grade e lista; D-050 web-design §5.9): horário DO ITEM, cliente, serviço do item,
 * status do item (masculino), encaixe do item e, só para o gestor, "n de N" com texto completo para o leitor
 * de tela ("serviço 1 de 3 do agendamento"). O profissional nunca recebe `posicao` (CA-33).
 */
export function ConteudoDoBloco({ bloco, faixa }: { bloco: BlocoDaAgenda; faixa: FaixaDoDia }) {
  return (
    <>
      <strong>{formatarFaixaDeMinutos(faixa.inicioMin, faixa.fimMin)}</strong> {nomeDaCliente(bloco)} · {bloco.servicoNome} ·{' '}
      {rotuloDoStatusDoItem(bloco.status)}
      {bloco.encaixe ? <> · {MENSAGENS_AGENDA.encaixe}</> : null}
      {bloco.posicao !== null ? (
        <>
          {' · '}
          <span aria-hidden="true">
            {bloco.posicao.n} de {bloco.posicao.de}
          </span>
          <span className={estilos.somenteLeitor}>
            serviço {bloco.posicao.n} de {bloco.posicao.de} do agendamento
          </span>
        </>
      ) : null}
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

/** Bloco de um ITEM na grade do dia; cor e borda pelo status do item; a falha de mensagem é da reserva. */
export function EventoDoBloco({ bloco, faixa, href, estiloExtra }: PropsBloco) {
  const classe = `${estilos.evento} ${estilos[bloco.status]}${bloco.temFalhaDeMensagem ? ` ${estilos.comFalha}` : ''}`;
  return (
    <a className={classe} href={href} style={estiloExtra} data-item={bloco.itemId}>
      {bloco.temFalhaDeMensagem ? <MarcaDeFalha variante="grade" /> : null}
      <ConteudoDoBloco bloco={bloco} faixa={faixa} />
    </a>
  );
}
