import type { DetalheSalao } from '@/server/admin/saloes-tipos';

import { SeloDaAssinatura, SeloDeSuspensao } from './SelosDoSalao';
import estilos from './Saloes.module.css';

/** Cabeçalho do detalhe (D-044 web-design §4): nome (h1), endereço atual e os selos de situação. */
export function CabecalhoDoSalao({ salao, hrefLista }: { salao: Pick<DetalheSalao, 'nome' | 'slug' | 'assinatura' | 'suspensoEm'>; hrefLista: string }) {
  return (
    <header className={estilos.cabecalho}>
      <p>
        <a href={hrefLista} className={estilos.link}>
          Voltar à lista
        </a>
      </p>
      <h1 className={estilos.quebra}>{salao.nome}</h1>
      <p className={`${estilos.suave} ${estilos.quebra}`}>/{salao.slug}</p>
      <ul className={estilos.selos} aria-label="Situação">
        <li>
          <SeloDaAssinatura estado={salao.assinatura?.estado ?? null} />
        </li>
        {salao.suspensoEm !== null ? (
          <li>
            <SeloDeSuspensao />
          </li>
        ) : null}
      </ul>
    </header>
  );
}
