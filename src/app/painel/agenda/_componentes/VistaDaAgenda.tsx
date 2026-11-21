import { MENSAGENS_AGENDA } from '@/server/agenda/tipos';
import type { AgendaVista } from '@/server/agenda/tipos';

import estilos from './Agenda.module.css';
import { hrefNovaReserva } from './links';
import { GradeDoDia } from './GradeDoDia';
import { ListaDaSemana } from './ListaDaSemana';
import { NavegacaoAgenda } from './NavegacaoAgenda';

type Props = {
  vista: AgendaVista;
  base: string;
  hrefReserva: (id: string) => string;
  /** Rota do formulário de reserva manual (a real ou a da vitrine); sem ela, a agenda não mostra o link. */
  baseNovaReserva?: string;
};

/** Conteúdo da página de agenda (a real e a vitrine usam este mesmo componente). Somente leitura. */
export function VistaDaAgenda({ vista, base, hrefReserva, baseNovaReserva }: Props) {
  return (
    <div className={estilos.pagina}>
      <h1>{MENSAGENS_AGENDA.titulo}</h1>
      {baseNovaReserva ? (
        <p>
          <a className={estilos.novaReserva} href={hrefNovaReserva(baseNovaReserva, vista)}>
            {MENSAGENS_AGENDA.novaReserva}
          </a>
        </p>
      ) : null}
      <NavegacaoAgenda vista={vista} base={base} />
      {vista.truncada ? (
        <p className={estilos.aviso} role="status">
          {MENSAGENS_AGENDA.truncada}
        </p>
      ) : null}
      {vista.colunas.length === 0 && vista.visao === 'dia' ? <p>{MENSAGENS_AGENDA.semColunas}</p> : null}
      {vista.visao === 'dia' ? (
        <GradeDoDia vista={vista} hrefReserva={hrefReserva} />
      ) : (
        <ListaDaSemana vista={vista} hrefReserva={hrefReserva} />
      )}
    </div>
  );
}
