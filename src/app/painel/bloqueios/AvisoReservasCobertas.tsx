import { MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';
import type { AvisoReservas } from '@/server/bloqueios/tipos';

import estilos from './Bloqueios.module.css';

/**
 * Aviso de reservas confirmadas sob o bloqueio (D-016 RN-8, D-7): posterior à gravação; as reservas não
 * mudam. Sem estado: os textos de data/hora chegam formatados do servidor. Mostra no máximo os itens
 * recebidos e diz quantos ficaram de fora quando `total` é maior.
 */
export function AvisoReservasCobertas({ aviso }: { aviso: AvisoReservas }) {
  if (aviso.total === 0) {
    return <p className={estilos.semReservas}>{MENSAGENS_BLOQUEIO.semReservas}</p>;
  }
  const fora = aviso.total - aviso.reservas.length;
  return (
    <div className={estilos.aviso}>
      <p className={estilos.avisoTitulo}>{MENSAGENS_BLOQUEIO.comReservas}</p>
      <ul className={estilos.avisoLista}>
        {aviso.reservas.map((r) => (
          <li key={r.itemId}>
            {r.inicioLocal} a {r.fimLocal} — {r.profissionalNome} — {r.cliente}
          </li>
        ))}
      </ul>
      {fora > 0 ? <p>{MENSAGENS_BLOQUEIO.maisReservas(fora)}</p> : null}
    </div>
  );
}
