import { EmptyState } from '@/components/ui/EmptyState';
import { MENSAGENS_CLIENTE, TEXTO_CLIENTE_REMOVIDA } from '@/server/clientes/tipos';
import type { ListaClientes as Lista } from '@/server/clientes/tipos';

import estilos from './Clientes.module.css';
import { hrefDaLista } from './estado';

export type ListaClientesProps = {
  lista: Lista;
  /** Endereço da lista (paginação preserva a busca). */
  base: string;
  /** Endereço do detalhe de cada cliente. */
  hrefDetalhe: (id: string) => string;
};

const contagem = (n: number) => (n === 1 ? '1 cliente' : `${n} clientes`);

/** Lista paginada (D-022 RN-8): nome, telefone formatado e link; contagem; Anterior/Próxima como links. */
export function ListaClientes({ lista, base, hrefDetalhe }: ListaClientesProps) {
  const { itens, total, pagina, porPagina, q } = lista;
  if (total === 0) {
    return <EmptyState titulo={MENSAGENS_CLIENTE.nenhumaEncontrada} nivelTitulo={2} descricao={q === '' ? 'As clientes aparecem aqui quando fizerem o primeiro agendamento.' : 'Tente outro nome ou telefone.'} />;
  }
  const ultima = Math.max(1, Math.ceil(total / porPagina));
  return (
    <div className={estilos.secao}>
      <p className={estilos.contagem} role="status">
        {contagem(total)}
        {ultima > 1 ? ` · página ${pagina} de ${ultima}` : ''}
      </p>
      {itens.length === 0 ? (
        <p>
          Esta página não tem clientes.{' '}
          <a className={estilos.link} href={hrefDaLista(base, q, 1)}>
            Voltar para a primeira página
          </a>
        </p>
      ) : (
        <ul className={estilos.lista}>
          {itens.map((c) => (
            <li key={c.id} className={estilos.item}>
              <a className={`${estilos.link} ${estilos.nome}`} href={hrefDetalhe(c.id)}>
                {c.nome ?? TEXTO_CLIENTE_REMOVIDA}
              </a>
              <span className={estilos.telefone}>{c.telefoneFormatado}</span>
            </li>
          ))}
        </ul>
      )}
      {ultima > 1 ? (
        <nav aria-label="Páginas de clientes" className={estilos.paginacao}>
          {pagina > 1 ? (
            <a className={estilos.link} href={hrefDaLista(base, q, Math.min(pagina - 1, ultima))} rel="prev">
              Anterior
            </a>
          ) : null}
          {pagina < ultima ? (
            <a className={estilos.link} href={hrefDaLista(base, q, pagina + 1)} rel="next">
              Próxima
            </a>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
