import { LIMITES_CLIENTE, MENSAGENS_CLIENTE } from '@/server/clientes/tipos';
import type { ItemHistorico } from '@/server/clientes/tipos';

import estilos from './Clientes.module.css';

export type HistoricoClienteProps = { itens: ItemHistorico[]; total: number };

/** Histórico de agendamentos (D-022 RN-15): data no fuso do salão, status, profissional, serviços, totais. */
export function HistoricoCliente({ itens, total }: HistoricoClienteProps) {
  return (
    <section className={estilos.secao} aria-labelledby="cliente-historico">
      <h2 id="cliente-historico">Agendamentos</h2>
      {itens.length === 0 ? (
        <p>{MENSAGENS_CLIENTE.semAgendamentos}</p>
      ) : (
        <>
          {total > itens.length ? (
            <p className={estilos.ajuda}>
              Mostrando os {LIMITES_CLIENTE.historicoMax} agendamentos mais recentes de {total}.
            </p>
          ) : null}
          <ul className={estilos.historico}>
            {itens.map((h) => (
              <li key={h.id} className={estilos.reserva}>
                <span>
                  <span className={estilos.quando}>{h.inicioLocal}</span> <span className={estilos.status}>({h.status})</span>
                </span>
                <span>Profissional: {h.profissional}</span>
                <span className={estilos.servicos}>Serviços: {h.servicos.join(', ')}</span>
                <span>
                  {h.duracaoTotal} · {h.precoTotal}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
