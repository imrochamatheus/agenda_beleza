import { MENSAGENS_AGENDA } from '@/server/agenda/tipos';
import type { DetalheDaReserva } from '@/server/agenda/tipos';

import estilos from './Agenda.module.css';
import { mostrarNotaDeCancelados, textoDoTotal } from './roteiro';

/**
 * Total dos itens (D-050 RN-35, web-design §5.10) e, quando cabe, a nota dos cancelados. Sem hooks: serve ao
 * detalhe somente leitura (servidor) e ao roteiro interativo (cliente).
 */
export function TotalDaReserva({ reserva }: { reserva: Pick<DetalheDaReserva, 'total' | 'temItemCancelado'> }) {
  const t = textoDoTotal(reserva.total);
  return (
    <>
      <p className={estilos.total}>
        <span>{t.rotulo}</span> <strong>{t.valor}</strong> · {t.servicos}
      </p>
      {mostrarNotaDeCancelados(reserva) ? <p className={estilos.nota}>{MENSAGENS_AGENDA.canceladosForaDoTotal}</p> : null}
    </>
  );
}
