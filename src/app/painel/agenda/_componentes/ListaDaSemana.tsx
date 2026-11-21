import { formatarDataCivil, formatarDiaDaSemana, formatarFaixaDeMinutos } from '@/lib/format';
import { recortarNoDia } from '@/server/agenda/faixas';
import { MENSAGENS_AGENDA } from '@/server/agenda/tipos';
import type { AgendaVista, FaixaDoDia } from '@/server/agenda/tipos';

import estilos from './Agenda.module.css';
import { ConteudoDaReserva, rotuloDoBloqueio } from './Eventos';

type Props = { vista: AgendaVista; hrefReserva: (id: string) => string };

/**
 * Visão por semana: lista empilhada por dia (sem grade horizontal, R-4), com os profissionais que têm
 * algo no dia. Os horários são recortados ao dia (reserva que cruza a meia-noite aparece nos dois).
 */
export function ListaDaSemana({ vista, hrefReserva }: Props) {
  return (
    <div className={estilos.pagina}>
      {vista.dias.map((dia) => {
        const porColuna = vista.colunas
          .map((c) => {
            const itens: ({ chave: string; faixa: FaixaDoDia } & (
              | { tipo: 'reserva'; i: number }
              | { tipo: 'bloqueio'; i: number }
            ))[] = [];
            c.reservas.forEach((r, i) => {
              const faixa = recortarNoDia(r.inicio, r.fim, dia, vista.fuso);
              if (faixa) itens.push({ chave: `r${r.id}`, faixa, tipo: 'reserva', i });
            });
            c.bloqueios.forEach((b, i) => {
              const faixa = recortarNoDia(b.inicio, b.fim, dia, vista.fuso);
              if (faixa) itens.push({ chave: `b${b.id}`, faixa, tipo: 'bloqueio', i });
            });
            itens.sort((a, b) => a.faixa.inicioMin - b.faixa.inicioMin);
            return { coluna: c, itens };
          })
          .filter((x) => x.itens.length > 0);
        return (
          <section key={dia.iso} className={estilos.dia} aria-labelledby={`dia-${dia.iso}`}>
            <h3 id={`dia-${dia.iso}`}>
              {formatarDiaDaSemana(dia.diaSemana)}, {formatarDataCivil(dia.iso)}
            </h3>
            {dia.salaoFechado ? <p className={estilos.etiqueta}>{MENSAGENS_AGENDA.salaoFechado}.</p> : null}
            {porColuna.length === 0 ? <p className={estilos.etiqueta}>{MENSAGENS_AGENDA.semReservas}</p> : null}
            {porColuna.map(({ coluna, itens }) => (
              <div key={coluna.id} className={estilos.coluna}>
                <h4>
                  {coluna.nome}
                  {coluna.ativo ? null : <span className={estilos.etiqueta}> ({MENSAGENS_AGENDA.inativo})</span>}
                </h4>
                <ul className={estilos.lista}>
                  {itens.map((it) => {
                    if (it.tipo === 'reserva') {
                      const r = coluna.reservas[it.i];
                      return (
                        <li key={it.chave} className={`${estilos.item} ${estilos[r.status]}`}>
                          <a href={hrefReserva(r.id)}>
                            <ConteudoDaReserva reserva={r} faixa={it.faixa} />
                          </a>
                        </li>
                      );
                    }
                    const b = coluna.bloqueios[it.i];
                    return (
                      <li key={it.chave} className={`${estilos.item} ${estilos.bloqueio}`}>
                        <strong>{formatarFaixaDeMinutos(it.faixa.inicioMin, it.faixa.fimMin)}</strong> {rotuloDoBloqueio(b)}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
