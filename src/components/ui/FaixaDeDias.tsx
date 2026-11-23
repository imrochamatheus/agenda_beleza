import estilos from './FaixaDeDias.module.css';

/** Um dia da régua; todos os textos chegam prontos (formatados pelo `src/lib/format.ts` no chamador). */
export type DiaDaFaixaDeDias = {
  /** 'AAAA-MM-DD' (chave do React). */
  chave: string;
  /** Dia da semana curto ("Ter") ou "Hoje". */
  semana: string;
  /** Número do dia, sem zero à esquerda ("1"). */
  dia: string;
  /** Mês curto ("dez"). */
  mes: string;
  /** Nome acessível completo, com os sufixos já aplicados ("Terça-feira, 01/12/2026, sem horários"). */
  rotulo: string;
  /** null = dia sem horário: `<span>`, fora da ordem de Tab. */
  href: string | null;
  /** Dia marcado (`aria-current="date"`). */
  atual: boolean;
};

export type LinkDaFaixaDeDias = { href: string; rotulo: string };

export type FaixaDeDiasProps = {
  /** `id` do `h3`; o do período é `${idTitulo}-periodo`. */
  idTitulo: string;
  titulo: string;
  /** Período já formatado ("29/11/2026 a 05/12/2026"). */
  periodo: string;
  /** 1 a 7 dias, em ordem; as colunas que sobram ficam vazias, sem `<li>`. */
  dias: readonly DiaDaFaixaDeDias[];
  /** null = limite da janela: nada é renderizado (nem texto inerte). */
  anterior: LinkDaFaixaDeDias | null;
  proxima: LinkDaFaixaDeDias | null;
  /** `aria-label` do `<nav>` das semanas. */
  rotuloNavegacao: string;
  apoio?: string;
  /** Classe extra no invólucro externo (ex.: a sangria até a borda do cartão, definida pelo contexto). */
  className?: string;
};

/**
 * Régua da semana (D-051 web-design §4.1): sete colunas iguais com o dia da semana, o número e o mês; um dia
 * com horário é link, um dia sem horário é texto. Componente de servidor, sem estado e sem JavaScript: dias e
 * semanas são links GET. Quando nenhum dia é link, o invólucro com rolagem vira um grupo focável (só assim a
 * região rolável abaixo de ~340 px tem como receber foco; decisão C2 do desenho).
 */
export function FaixaDeDias({
  idTitulo,
  titulo,
  periodo,
  dias,
  anterior,
  proxima,
  rotuloNavegacao,
  apoio,
  className,
}: FaixaDeDiasProps) {
  const idPeriodo = `${idTitulo}-periodo`;
  const rotulada = `${idTitulo} ${idPeriodo}`;
  const semLinks = dias.every((d) => d.href === null);
  return (
    <div className={className ? `${estilos.faixa} ${className}` : estilos.faixa}>
      <div className={estilos.cabecalho}>
        <h3 id={idTitulo} className={estilos.titulo}>
          {titulo}
        </h3>
        <p id={idPeriodo} className={estilos.periodo}>
          {periodo}
        </p>
      </div>
      <div
        className={estilos.rolagem}
        {...(semLinks ? { tabIndex: 0, role: 'group', 'aria-labelledby': rotulada } : {})}
      >
        <ol className={estilos.regua} aria-labelledby={rotulada}>
          {dias.map((d) => {
            const conteudo = (
              <>
                <span aria-hidden="true" className={estilos.semana}>
                  {d.semana}
                </span>
                <span aria-hidden="true" className={estilos.numero}>
                  {d.dia}
                </span>
                <span aria-hidden="true" className={estilos.mes}>
                  {d.mes}
                </span>
                <span className="visualmente-oculto">{d.rotulo}</span>
              </>
            );
            const atual = d.atual ? ({ 'aria-current': 'date' } as const) : {};
            return (
              <li key={d.chave} className={estilos.item}>
                {d.href !== null ? (
                  <a href={d.href} className={estilos.dia} {...atual}>
                    {conteudo}
                  </a>
                ) : (
                  <span className={`${estilos.dia} ${estilos.semHorario}`} {...atual}>
                    {conteudo}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {anterior !== null || proxima !== null ? (
        <nav aria-label={rotuloNavegacao} className={estilos.semanas}>
          <ul>
            {anterior !== null ? (
              <li className={estilos.anterior}>
                <a href={anterior.href}>
                  <span aria-hidden="true">←</span> {anterior.rotulo}
                </a>
              </li>
            ) : null}
            {proxima !== null ? (
              <li className={estilos.proxima}>
                <a href={proxima.href}>
                  {proxima.rotulo} <span aria-hidden="true">→</span>
                </a>
              </li>
            ) : null}
          </ul>
        </nav>
      ) : null}
      {apoio ? <p className={estilos.apoio}>{apoio}</p> : null}
    </div>
  );
}
