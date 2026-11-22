import { Alert } from '@/components/ui/Alert';
import { DataList } from '@/components/ui/DataList';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { formatarDataCivil, formatarInteiro } from '@/lib/format';
import type { ListaAuditoria, RegistroAuditoriaDTO } from '@/server/admin/auditoria-tipos';
import { hrefDaAuditoria, haFiltroNaAuditoria } from '@/server/admin/auditoria-validacao';
import { TEXTO_FILTRO_INVALIDO } from '@/server/admin/mensagens-tipos';
import { CODIGOS_DE_ACAO, RESULTADOS_AUDITORIA, rotuloDaAcao, seloDaAuditoria } from '@/server/admin/rotulos-admin';

import { AntesDepois } from '../../_componentes/AntesDepois';
import estilosAdmin from '../../_componentes/Admin.module.css';
import { CampoDeSalao, FiltrosGet, PaginacaoAdmin, ResumoDaLista } from '../../_componentes/FiltrosGet';
import { SeloDeEstado } from '../../_componentes/SeloDeEstado';
import { avisoDeFusoGlobal, quandoGlobal } from '../../_componentes/quando';

export type TelaDeAuditoriaProps = {
  lista: ListaAuditoria;
  /** Caminho da própria tela (GET dos filtros e da paginação; a vitrine usa outro). */
  base: string;
  hrefDoSalao: (id: string) => string;
  /** Campos ocultos dos filtros (a vitrine usa `vista`). */
  ocultos?: Record<string, string>;
};

const OPCOES_ACAO = CODIGOS_DE_ACAO.map((a) => ({ valor: a, rotulo: rotuloDaAcao(a) })).sort((x, y) => x.rotulo.localeCompare(y.rotulo, 'pt-BR'));
const OPCOES_RESULTADO = RESULTADOS_AUDITORIA.map((r) => ({ valor: r, rotulo: seloDaAuditoria(r).rotulo }));

function textoDoResumo(l: ListaAuditoria): string {
  const f = l.filtros;
  const partes = [`${formatarInteiro(l.itens.length)} de ${formatarInteiro(l.total)} ${l.total === 1 ? 'registro' : 'registros'}`];
  if (f.acao !== null) partes.push(`Ação: ${rotuloDaAcao(f.acao)}`);
  if (f.resultado !== null) partes.push(`Resultado: ${seloDaAuditoria(f.resultado).rotulo}`);
  if (f.ator !== null) partes.push(`Ator: ${f.ator}`);
  if (f.salaoId !== null) {
    const nome = l.salao.modo === 'select' ? l.salao.opcoes.find((o) => o.id === f.salaoId)?.nome : undefined;
    partes.push(`Salão: ${nome ?? f.salaoId}`);
  }
  if (f.de !== null) partes.push(`De ${formatarDataCivil(f.de)}`);
  if (f.ate !== null) partes.push(`Até ${formatarDataCivil(f.ate)}`);
  return partes.join(' · ');
}

/**
 * Corpo da tela "Auditoria" (D-045, web-design §5.3): filtros por GET, a lista de registros e a paginação.
 * Somente leitura. `antes`/`depois` saem como gravados (escapados), em `<details>` com diff por campo.
 */
export function TelaDeAuditoria({ lista, base, hrefDoSalao, ocultos }: TelaDeAuditoriaProps) {
  const { filtros, erros, ecoes } = lista;
  const ativo = haFiltroNaAuditoria(filtros);
  const salaoFiltrado = filtros.salaoId !== null;
  return (
    <div className={estilosAdmin.pagina}>
      <p className={estilosAdmin.suave}>{avisoDeFusoGlobal()} Somente leitura.</p>

      <FiltrosGet rotulo="Filtrar registros de auditoria" base={base} ocultos={ocultos} ativo={ativo || salaoFiltrado}>
        <CampoDeSalao filtro={lista.salao} valor={filtros.salaoId} />
        <Field
          id="filtro-ator"
          name="ator"
          tipo="text"
          rotulo="Ator (e-mail)"
          defaultValue={ecoes.ator}
          maxLength={254}
          autoComplete="off"
          ajuda="E-mail exato."
          erro={erros.ator}
        />
        <Select name="acao" rotulo="Ação" textoVazio="Todas" defaultValue={filtros.acao ?? ''} opcoes={OPCOES_ACAO} />
        <Select name="resultado" rotulo="Resultado" textoVazio="Todos" defaultValue={filtros.resultado ?? ''} opcoes={OPCOES_RESULTADO} />
        <Field id="filtro-de" name="de" tipo="date" rotulo="De" defaultValue={ecoes.de} erro={erros.de} />
        <Field id="filtro-ate" name="ate" tipo="date" rotulo="Até" defaultValue={ecoes.ate} erro={erros.ate} />
      </FiltrosGet>

      <ResumoDaLista texto={textoDoResumo(lista)} />
      {lista.ignorados ? <Alert variante="info">{TEXTO_FILTRO_INVALIDO}</Alert> : null}

      <DataList<RegistroAuditoriaDTO>
        legenda="Registros de auditoria"
        chaveDaLinha={(r) => r.id}
        linhas={lista.itens}
        detalhe={(r) => (r.antes === null && r.depois === null ? null : <AntesDepois antes={r.antes} depois={r.depois} />)}
        vazio={
          lista.total > 0 ? (
            <EmptyState
              titulo="Nenhum registro nesta página"
              descricao="A página pedida está além do fim da lista."
              acao={
                <a href={hrefDaAuditoria(base, filtros, 1)} className={estilosAdmin.link}>
                  Ir para a primeira página
                </a>
              }
            />
          ) : (
            <EmptyState
              titulo="Nenhum registro encontrado"
              acao={
                ativo ? (
                  <a href={base} className={estilosAdmin.link}>
                    Limpar filtros
                  </a>
                ) : undefined
              }
            />
          )
        }
        colunas={[
          {
            chave: 'acao', classeCelula: estilosAdmin.celulaTexto,
            rotulo: 'Registro',
            renderizar: (r) => (
              <span className={estilosAdmin.pilha}>
                <span>{quandoGlobal(r.ocorridoEm)}</span>
                <span>{rotuloDaAcao(r.acao)}</span>
                <span className={`${estilosAdmin.apoio} ${estilosAdmin.apoioMono}`}>{r.acao}</span>
                {r.entidade !== null ? <span className={estilosAdmin.apoio}>Entidade: {r.entidade}</span> : null}
              </span>
            ),
          },
          {
            chave: 'quem', classeCelula: estilosAdmin.celulaTexto,
            rotulo: 'Quem e onde',
            renderizar: (r) => (
              <span className={estilosAdmin.pilha}>
                <span className={estilosAdmin.quebra}>{r.atorEmail ?? 'Sistema'}</span>
                {r.salaoId !== null ? (
                  <a href={hrefDoSalao(r.salaoId)} className={`${estilosAdmin.apoio} ${estilosAdmin.quebra}`}>
                    {r.salaoNome ?? r.salaoId}
                  </a>
                ) : (
                  <span className={estilosAdmin.apoio}>—</span>
                )}
              </span>
            ),
          },
          {
            chave: 'resultado',
            rotulo: 'Resultado',
            classeCelula: estilosAdmin.celulaSelo,
            renderizar: (r) => {
              const s = seloDaAuditoria(r.resultado);
              return (
                <SeloDeEstado forma={s.forma} variante={s.variante}>
                  {s.rotulo}
                </SeloDeEstado>
              );
            },
          },
        ]}
      />

      <PaginacaoAdmin pagina={lista.pagina} paginas={lista.paginas} href={(p) => hrefDaAuditoria(base, filtros, p)} />
    </div>
  );
}
