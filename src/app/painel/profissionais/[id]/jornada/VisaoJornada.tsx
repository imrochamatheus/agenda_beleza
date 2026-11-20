import { formatarDiaDaSemana } from '@/lib/format';
import { ORDEM_EXIBICAO_DIAS } from '@/server/jornadas/tipos';
import type { SemanaJornada } from '@/server/jornadas/tipos';

import { textoDasPausas, textoDosIntervalos } from './estado';
import estilos from './Jornada.module.css';

/**
 * Jornada somente leitura (D-015 §3.6; CA-12, CA-15): de segunda a domingo, os intervalos e as pausas
 * de cada dia, ou "Folga". Sem campos nem botão. Componente de servidor (também usado na demonstração).
 */
export function VisaoJornada({ semana }: { semana: SemanaJornada }) {
  return (
    <dl className={estilos.visao}>
      {ORDEM_EXIBICAO_DIAS.map((dia) => {
        const pausas = textoDasPausas(semana[dia]);
        return (
          <div key={dia} className={estilos.visaoDia}>
            <dt>{formatarDiaDaSemana(dia)}</dt>
            <dd>{textoDosIntervalos(semana[dia])}</dd>
            {pausas ? <dd className={estilos.pausas}>{pausas}</dd> : null}
          </div>
        );
      })}
    </dl>
  );
}
