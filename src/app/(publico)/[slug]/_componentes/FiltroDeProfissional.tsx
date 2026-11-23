import estilos from './Salao.module.css';

export type OpcaoDeFiltro = {
  /** "Todos (3)", "Ana"… */
  rotulo: string;
  /** GET com toda a query do fluxo preservada (`hrefFiltro`). */
  href: string;
  atual: boolean;
};

/**
 * Filtro por profissional do passo de um serviço (D-050 web-design §4.3): barra de links GET em pílulas, o
 * atual com `aria-current="true"`. Quem chama só o mostra com 2+ profissionais elegíveis. Funciona sem JS.
 */
export function FiltroDeProfissional({ opcoes }: { opcoes: readonly OpcaoDeFiltro[] }) {
  return (
    <nav aria-label="Filtrar por profissional" className={estilos.filtro}>
      <ul className={estilos.pilulas}>
        {opcoes.map((o) => (
          <li key={o.href}>
            <a href={o.href} className={estilos.pilula} aria-current={o.atual ? 'true' : undefined}>
              {o.rotulo}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
