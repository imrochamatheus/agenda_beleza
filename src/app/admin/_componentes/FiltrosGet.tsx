import type { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import type { FiltroDeSalao } from '@/server/admin/paginacao';

import estilos from './Admin.module.css';

// Peças compartilhadas das listas globais do admin (D-045 web-design §4.2). Filtros por GET: funcionam sem
// JavaScript; o estado dos filtros fica na URL, na linha de contagem (aria-live) e no "Limpar filtros".

export type FiltrosGetProps = {
  /** Nome acessível do formulário de busca ("Filtrar mensagens"). */
  rotulo: string;
  /** Caminho da própria lista (GET e "Limpar filtros"). */
  base: string;
  /** Há algum filtro ativo → mostra "Limpar filtros". */
  ativo: boolean;
  /** Campos ocultos fixos (a vitrine usa `vista`). */
  ocultos?: Record<string, string>;
  children: ReactNode;
};

export function FiltrosGet({ rotulo, base, ativo, ocultos, children }: FiltrosGetProps) {
  return (
    <form method="get" action={base.split('?')[0]} role="search" aria-label={rotulo} className={estilos.filtros}>
      {Object.entries(ocultos ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <div className={estilos.acoesFiltro}>
        <Button type="submit" variante="secundaria">
          Filtrar
        </Button>
        {ativo ? (
          <a href={base} className={estilos.link}>
            Limpar filtros
          </a>
        ) : null}
      </div>
    </form>
  );
}

/** Linha de contagem e filtros ativos, anunciada com `aria-live="polite"`. */
export function ResumoDaLista({ texto }: { texto: string }) {
  return (
    <p className={estilos.suave} aria-live="polite">
      {texto}
    </p>
  );
}

/** Campo de salão: `Select` (até o limite) ou campo de código (UUID) acima disso. */
export function CampoDeSalao({ filtro, valor }: { filtro: FiltroDeSalao; valor: string | null }) {
  if (filtro.modo === 'codigo') {
    return (
      <Field
        id="filtro-salao"
        name="salao"
        rotulo="Código do salão"
        defaultValue={valor ?? ''}
        maxLength={36}
        autoComplete="off"
        ajuda="Use o código que aparece na página do salão."
      />
    );
  }
  return (
    <Select
      id="filtro-salao"
      name="salao"
      rotulo="Salão"
      textoVazio="Todos"
      defaultValue={valor ?? ''}
      opcoes={filtro.opcoes.map((o) => ({ valor: o.id, rotulo: o.nome }))}
    />
  );
}

export type PaginacaoAdminProps = {
  pagina: number;
  paginas: number;
  /** URL de uma página (preserva os filtros). */
  href: (pagina: number) => string;
};

export function PaginacaoAdmin({ pagina, paginas, href }: PaginacaoAdminProps) {
  if (paginas <= 1) return null;
  return (
    <nav aria-label="Paginação" className={estilos.paginacao}>
      {pagina > 1 ? <a href={href(pagina - 1)}>Anterior</a> : null}
      <span>
        Página {pagina} de {paginas}
      </span>
      {pagina < paginas ? <a href={href(pagina + 1)}>Próxima</a> : null}
    </nav>
  );
}
