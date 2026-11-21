import { MENSAGENS_AGENDA } from '@/server/agenda/tipos';
import type { AgendaVista } from '@/server/agenda/tipos';

import estilos from './Agenda.module.css';
import { GradeDoDia } from './GradeDoDia';
import { ListaDaSemana } from './ListaDaSemana';
import { NavegacaoAgenda } from './NavegacaoAgenda';

type Props = { vista: AgendaVista; base: string; hrefReserva: (id: string) => string };

/** Conteúdo da página de agenda (a real e a vitrine usam este mesmo componente). Somente leitura. */
export function VistaDaAgenda({ vista, base, hrefReserva }: Props) {
  return (
    <div className={estilos.pagina}>
      <h1>{MENSAGENS_AGENDA.titulo}</h1>
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
