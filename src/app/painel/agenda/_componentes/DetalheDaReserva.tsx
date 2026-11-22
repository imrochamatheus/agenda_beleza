import { formatarDataHora, formatarDuracao, formatarMoeda, formatarTelefone } from '@/lib/format';
import { SituacaoMensagens } from '@/components/agenda/SituacaoMensagens';
import { rotuloDaOrigem, rotuloDoStatus } from '@/server/agenda/rotulos';
import { MENSAGENS_AGENDA } from '@/server/agenda/tipos';
import type { DetalheDaReserva as Detalhe } from '@/server/agenda/tipos';
import { TEXTO_CLIENTE_REMOVIDA } from '@/server/clientes/tipos';
import type { MensagemSituacao } from '@/server/mensagens/situacao-tipos';

import estilos from './Agenda.module.css';

type Props = { reserva: Detalhe; hrefVoltar: string; mensagens: readonly MensagemSituacao[] };

/** Detalhe somente leitura (RN-10) com a situação das mensagens (D-043); telefone só se `contato` veio. */
export function DetalheDaReserva({ reserva, hrefVoltar, mensagens }: Props) {
  const r = reserva;
  return (
    <div className={estilos.pagina}>
      <h1>Reserva</h1>
      <p>
        <a href={hrefVoltar}>Voltar para a agenda</a>
      </p>
      <dl className={estilos.detalhe}>
        <dt>Profissional</dt>
        <dd>
          {r.profissional.nome}
          {r.profissional.ativo ? null : ` (${MENSAGENS_AGENDA.inativo})`}
        </dd>
        <dt>Cliente</dt>
        <dd>{r.clienteNome ?? TEXTO_CLIENTE_REMOVIDA}</dd>
        {r.contato !== null ? (
          <>
            <dt>Telefone</dt>
            <dd>{formatarTelefone(r.contato.telefoneE164)}</dd>
          </>
        ) : null}
        <dt>Início</dt>
        <dd>{formatarDataHora(r.inicio, r.fuso)}</dd>
        <dt>Fim</dt>
        <dd>{formatarDataHora(r.fim, r.fuso)}</dd>
        <dt>Situação</dt>
        <dd>{rotuloDoStatus(r.status)}</dd>
        <dt>Origem</dt>
        <dd>
          {rotuloDaOrigem(r.origem)}
          {r.encaixe ? ` · ${MENSAGENS_AGENDA.encaixe}` : ''}
        </dd>
      </dl>
      <section aria-labelledby="reserva-itens">
        <h2 id="reserva-itens">Serviços</h2>
        <ul className={estilos.lista}>
          {r.itens.map((i, n) => (
            <li key={n} className={estilos.item}>
              <span>{i.nome}</span>
              <span>
                {formatarMoeda(i.precoCentavos)} · {formatarDuracao(i.duracaoMin)}
              </span>
            </li>
          ))}
        </ul>
        <p>
          <strong>Total: {formatarMoeda(r.totalCentavos)}</strong> · {formatarDuracao(r.duracaoTotalMin)}
        </p>
      </section>
      <SituacaoMensagens mensagens={mensagens} fuso={r.fuso} />
    </div>
  );
}
