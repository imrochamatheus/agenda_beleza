import { LIMITES_CLIENTE, MENSAGENS_CLIENTE } from '@/server/clientes/tipos';
import type { ItemHistorico } from '@/server/clientes/tipos';

import estilos from './Clientes.module.css';

export type HistoricoClienteProps = { itens: ItemHistorico[]; total: number };

/**
 * Histórico de agendamentos (D-022 RN-15; D-050 RN-35): data no fuso do salão e status derivado da reserva;
 * cada serviço com hora, profissional, preço e status próprios (cancelado riscado, rótulo não riscado);
 * total dos não cancelados, ou de todos numa reserva toda cancelada.
 */
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
                <ul className={estilos.itensReserva} aria-label="Serviços">
                  {h.servicos.map((s, k) => (
                    <li key={k} className={estilos.servicos}>
                      <span className={s.cancelado ? estilos.itemCancelado : undefined}>
                        {s.horaLocal} · {s.servico} · com {s.profissional} · {s.preco}
                      </span>{' '}
                      <span className={estilos.status}>({s.status})</span>
                    </li>
                  ))}
                </ul>
                <span>
                  {h.totalDaCancelada ? 'Total (cancelada)' : 'Total'}: {h.precoTotal}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
