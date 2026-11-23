import type { ReactNode } from 'react';

import { SituacaoMensagens } from '@/components/agenda/SituacaoMensagens';
import { RoteiroDoDia } from '@/components/ui/RoteiroDoDia';
import { formatarTelefone } from '@/lib/format';
import { rotuloDaOrigem, rotuloDoStatus } from '@/server/agenda/rotulos';
import { MENSAGENS_AGENDA } from '@/server/agenda/tipos';
import type { DetalheDaReserva as Detalhe } from '@/server/agenda/tipos';
import { TEXTO_CLIENTE_REMOVIDA } from '@/server/clientes/tipos';
import type { MensagemSituacao } from '@/server/mensagens/situacao-tipos';

import estilos from './Agenda.module.css';
import { paradasDaReserva, ROTULO_DO_ROTEIRO, textoDaData } from './roteiro';
import { TotalDaReserva } from './TotalDaReserva';

/** `id` do resultado do PRG: o redirect leva `#resultado` e o navegador põe o foco nele (sem JavaScript). */
export const ID_DO_RESULTADO = 'resultado';

type Props = {
  reserva: Detalhe;
  hrefVoltar: string;
  mensagens: readonly MensagemSituacao[];
  /** Texto do resultado do PRG (já montado a partir da lista fechada); null = nenhum. */
  resultado?: string | null;
  /**
   * Roteiro interativo (ações por item, ver `reservas/[id]/AcoesDaReserva`). Sem ele, o roteiro é somente
   * leitura (vitrine /dev/agenda).
   */
  roteiro?: ReactNode;
};

/**
 * Detalhe da reserva (D-028 RN-10; D-050 web-design §5.10): dados da cliente e do agendamento na `dl` (Data
 * substitui Início/Fim; profissional e horário vão para cada serviço), o roteiro dos serviços com status por
 * item e o total, e a situação das mensagens (D-043). Telefone só se `contato` veio.
 */
export function DetalheDaReserva({ reserva, hrefVoltar, mensagens, resultado = null, roteiro }: Props) {
  const r = reserva;
  return (
    <div className={estilos.pagina}>
      <h1>Reserva</h1>
      <p>
        <a href={hrefVoltar}>Voltar para a agenda</a>
      </p>
      {resultado ? (
        <p id={ID_DO_RESULTADO} role="status" tabIndex={-1} className={estilos.resultado}>
          {resultado}
        </p>
      ) : null}
      <dl className={estilos.detalhe}>
        <dt>Cliente</dt>
        <dd>{r.clienteNome ?? TEXTO_CLIENTE_REMOVIDA}</dd>
        {r.contato !== null ? (
          <>
            <dt>Telefone</dt>
            <dd>{formatarTelefone(r.contato.telefoneE164)}</dd>
          </>
        ) : null}
        <dt>Data</dt>
        <dd>{textoDaData(r.data)}</dd>
        <dt>Situação</dt>
        <dd>{rotuloDoStatus(r.status)}</dd>
        <dt>Origem</dt>
        <dd>{rotuloDaOrigem(r.origem)}</dd>
      </dl>
      <section aria-labelledby="reserva-itens" className={estilos.servicos}>
        <h2 id="reserva-itens">Serviços</h2>
        {r.papel === 'profissional' ? <p className={estilos.nota}>{MENSAGENS_AGENDA.apenasSeusServicos}</p> : null}
        {roteiro ?? <RoteiroDoDia rotulo={ROTULO_DO_ROTEIRO} paradas={paradasDaReserva(r)} rodape={<TotalDaReserva reserva={r} />} />}
      </section>
      <SituacaoMensagens mensagens={mensagens} fuso={r.fuso} />
    </div>
  );
}
