import { forwardRef } from 'react';

import type { ItemDoResumo } from './formulario';
import estilos from './Semana.module.css';

export type ResumoDeErrosProps = {
  /** Id do contêiner; o título usa `<id>-titulo`. */
  id: string;
  titulo: string;
  itens: readonly ItemDoResumo[];
};

/**
 * Resumo de erros focável (D-020 §3.7, extraído da jornada): `role="alert"`, título e um link por erro,
 * que leva ao campo. Quem usa foca o contêiner pela ref quando há erros.
 */
export const ResumoDeErros = forwardRef<HTMLDivElement, ResumoDeErrosProps>(function ResumoDeErros({ id, titulo, itens }, ref) {
  return (
    <div ref={ref} id={id} tabIndex={-1} className={estilos.resumoErros} role="alert" aria-labelledby={`${id}-titulo`}>
      <p id={`${id}-titulo`} className={estilos.resumoTitulo}>
        {titulo}
      </p>
      <ul>
        {itens.map((item) => (
          <li key={item.href + item.texto}>
            <a href={item.href}>{item.texto}</a>
          </li>
        ))}
      </ul>
    </div>
  );
});
