import { formatarDataCivil, formatarDiaDaSemana } from '@/lib/format';
import type { AgendaVista, Visao } from '@/server/agenda/tipos';

import estilos from './Agenda.module.css';
import { hrefAgenda } from './links';

type Props = { vista: AgendaVista; base: string };

/** Título do período (dia: "Terça-feira, 01/12/2026"; semana: "Semana de 29/11/2026 a 05/12/2026"). */
export function tituloDoPeriodo(vista: AgendaVista): string {
  if (vista.visao === 'dia') {
    const d = vista.dias[0];
    return `${formatarDiaDaSemana(d.diaSemana)}, ${formatarDataCivil(d.iso)}`;
  }
  return `Semana de ${formatarDataCivil(vista.dias[0].iso)} a ${formatarDataCivil(vista.dias[vista.dias.length - 1].iso)}`;
}

/**
 * Navegação por links e formulário GET (RN-13, CA-14): funciona sem JavaScript. Dia/semana anterior e
 * próximo, hoje, dia ↔ semana e o filtro de profissional (só o gestor recebe as opções).
 */
export function NavegacaoAgenda({ vista, base }: Props) {
  const dia = vista.visao === 'dia';
  const filtro = vista.profissionalFiltro;
  const link = (data: string, visao: Visao) => hrefAgenda(base, { data, visao, profissional: filtro });
  return (
    <div className={estilos.pagina}>
      <nav aria-label="Período da agenda">
        <ul className={estilos.barra}>
          <li>
            <a className={estilos.botaoLink} href={link(vista.anterior, vista.visao)}>
              {dia ? 'Dia anterior' : 'Semana anterior'}
            </a>
          </li>
          <li>
            <a className={estilos.botaoLink} href={link(vista.hoje, vista.visao)}>
              Hoje
            </a>
          </li>
          <li>
            <a className={estilos.botaoLink} href={link(vista.proximo, vista.visao)}>
              {dia ? 'Próximo dia' : 'Próxima semana'}
            </a>
          </li>
        </ul>
      </nav>
      <nav aria-label="Visão da agenda">
        <ul className={estilos.barra}>
          {(['dia', 'semana'] as const).map((v) => (
            <li key={v}>
              <a
                className={estilos.botaoLink}
                href={link(vista.data, v)}
                aria-current={vista.visao === v ? 'true' : undefined}
              >
                {v === 'dia' ? 'Dia' : 'Semana'}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {vista.profissionais.length > 0 ? (
        <form method="get" action={base} className={estilos.filtro}>
          <input type="hidden" name="data" value={vista.data} />
          <input type="hidden" name="visao" value={vista.visao} />
          <label>
            Profissional
            <select name="profissional" defaultValue={filtro ?? ''}>
              <option value="">Todos os profissionais</option>
              {vista.profissionais.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.ativo ? p.nome : `${p.nome} (inativo)`}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={estilos.botaoLink}>
            Filtrar
          </button>
        </form>
      ) : null}
      <h2>{tituloDoPeriodo(vista)}</h2>
    </div>
  );
}
