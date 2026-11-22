import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { formatarInteiro } from '@/lib/format';
import { ESTADOS_FILTRO, MENSAGENS_ADMIN_SALOES as M } from '@/server/admin/saloes-tipos';
import type { FiltrosSaloes, LinhaSalao, ListaSaloes as Lista } from '@/server/admin/saloes-tipos';
import { rotuloDeSituacao } from '@/server/assinatura/rotulos';

import { hrefDaLista } from '../estado';
import { SeloDeEstado, SeloDeSuspensao } from './SeloDeEstado';
import estilos from './Saloes.module.css';

export type ListaDeSaloesProps = {
  lista: Lista;
  filtros: FiltrosSaloes;
  /** Caminho da própria lista (GET dos filtros e da paginação; a vitrine usa outro). */
  base: string;
  /** Caminho do detalhe de um salão (a vitrine usa outro). */
  hrefDoSalao: (id: string) => string;
};

const OPCOES_ESTADO = ESTADOS_FILTRO.map((e) => ({ valor: e, rotulo: rotuloDeSituacao(e) }));
const OPCOES_SUSPENSAO = [
  { valor: 'sim', rotulo: 'Sim' },
  { valor: 'nao', rotulo: 'Não' },
];

/**
 * Lista de salões (D-044 CA-1, web-design §5.1): filtros por GET (funcionam sem JavaScript), `DataList`
 * (tabela em 48rem ou mais, linhas empilhadas abaixo), 20 por página, paginação que preserva os filtros.
 * Nada sensível chega aqui: só nome, endereço atual, estado, suspensão e e-mail do gestor.
 */
export function ListaDeSaloes({ lista, filtros, base, hrefDoSalao }: ListaDeSaloesProps) {
  const paginas = Math.max(1, Math.ceil(lista.total / lista.porPagina));
  const filtrada = filtros.q !== '' || filtros.estado !== null || filtros.suspenso !== 'todas';
  return (
    <div className={estilos.pagina}>
      <form method="get" action={base} className={estilos.filtros}>
        <Field
          id="salao-q"
          name="q"
          rotulo="Buscar por nome, endereço ou e-mail do gestor"
          defaultValue={filtros.q}
          maxLength={80}
          autoComplete="off"
        />
        <Select name="estado" rotulo="Assinatura" defaultValue={filtros.estado ?? ''} textoVazio="Todas" opcoes={OPCOES_ESTADO} />
        <Select
          name="suspenso"
          rotulo="Suspensão manual"
          defaultValue={filtros.suspenso === 'todas' ? '' : filtros.suspenso}
          textoVazio="Todas"
          opcoes={OPCOES_SUSPENSAO}
        />
        <div className={estilos.acoesFiltro}>
          <Button type="submit">Filtrar</Button>
          {filtrada ? (
            <a href={base} className={estilos.link}>
              Limpar filtros
            </a>
          ) : null}
        </div>
      </form>
      <p className={estilos.suave} aria-live="polite">
        {formatarInteiro(lista.total)} {lista.total === 1 ? 'salão' : 'salões'}
      </p>
      <DataList<LinhaSalao>
        legenda="Salões da plataforma"
        chaveDaLinha={(l) => l.id}
        linhas={lista.itens}
        vazio={<EmptyState titulo={M.vazioTitulo} descricao={M.vazioDescricao} />}
        colunas={[
          {
            chave: 'salao',
            rotulo: 'Salão',
            renderizar: (l) => (
              <a href={hrefDoSalao(l.id)} aria-label={`Abrir ${l.nome}`} className={estilos.quebra}>
                {l.nome}
              </a>
            ),
          },
          { chave: 'endereco', rotulo: 'Endereço', renderizar: (l) => <span className={estilos.quebra}>/{l.slug}</span> },
          { chave: 'assinatura', rotulo: 'Assinatura', renderizar: (l) => <SeloDeEstado estado={l.estado} /> },
          { chave: 'suspensao', rotulo: 'Suspensão', renderizar: (l) => (l.suspenso ? <SeloDeSuspensao /> : '-') },
          { chave: 'gestor', rotulo: 'Gestor', renderizar: (l) => <span className={estilos.quebra}>{l.gestorEmail ?? '-'}</span> },
        ]}
      />
      {paginas > 1 ? (
        <nav aria-label="Paginação" className={estilos.paginacao}>
          {lista.pagina > 1 ? <a href={hrefDaLista(base, filtros, lista.pagina - 1)}>Anterior</a> : null}
          <span>
            Página {lista.pagina} de {paginas}
          </span>
          {lista.pagina < paginas ? <a href={hrefDaLista(base, filtros, lista.pagina + 1)}>Próxima</a> : null}
        </nav>
      ) : null}
    </div>
  );
}
