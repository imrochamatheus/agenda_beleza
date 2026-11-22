import type { ReactNode } from 'react';

import estilos from './Saloes.module.css';

/** Seção do detalhe (web-design §4): `h2` com filete; cada seção tem o seu próprio formulário e botão. */
export function SecaoDoSalao({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section className={estilos.secao} aria-labelledby={`${id}-titulo`}>
      <h2 id={`${id}-titulo`}>{titulo}</h2>
      {children}
    </section>
  );
}
