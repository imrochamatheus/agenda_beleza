import { DataList } from '@/components/ui/DataList';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatarDeslocamentoUtc } from '@/lib/format';
import { MENSAGENS_ASSINATURA_ADMIN as M } from '@/server/admin/assinatura-tipos';
import type { AssinaturaDoSalaoDTO, EventoDTO, TransicaoDTO } from '@/server/admin/assinatura-tipos';
import { SELO_ORIGEM_INVALIDA, seloDoWebhook } from '@/server/admin/rotulos-admin';
import { rotuloDeSituacao } from '@/server/assinatura/rotulos';

import { JsonLegivel } from '../../../../_componentes/AntesDepois';
import estilosAdmin from '../../../../_componentes/Admin.module.css';
import { SeloDeEstado } from '../../../../_componentes/SeloDeEstado';
import { quandoNoFuso } from '../../../../_componentes/quando';
import { SeloDaAssinatura } from '../../../_componentes/SelosDoSalao';
import estilos from './Assinatura.module.css';

export type TelaDeAssinaturaProps = {
  dados: AssinaturaDoSalaoDTO;
  hrefSalao: string;
  hrefAuditoria: string;
};

/**
 * Corpo da tela "Assinatura e eventos" de um salão (D-045 web-design §5.1): resumo, transições e eventos de
 * webhook, no fuso do salão. Somente leitura. Nunca o id do provedor; campos nulos do resumo são omitidos.
 */
export function TelaDeAssinatura({ dados, hrefSalao, hrefAuditoria }: TelaDeAssinaturaProps) {
  const { salao, assinatura: a } = dados;
  const quando = (iso: string) => quandoNoFuso(iso, salao.fuso);
  const fuso = `${salao.fuso}, ${formatarDeslocamentoUtc(new Date(), salao.fuso)}`;
  const campos: [string, string | null][] =
    a === null
      ? []
      : [
          ['Fim do teste', a.testeFimEm],
          ['Pago até', a.periodoPagoAte],
          ['Primeira falha', a.primeiraFalhaEm],
          ['Carência até', a.carenciaAte],
          ['Cancelada em', a.canceladaEm],
          ['Acesso até', a.acessoAte],
        ].map(([r, v]) => [r as string, v === null ? null : quando(v as string)]);
  return (
    <div className={estilosAdmin.coluna}>
      <p>
        <a href={hrefSalao} className={estilosAdmin.link}>
          Voltar ao salão
        </a>
      </p>
      <h1 className={estilosAdmin.quebra}>Assinatura de {salao.nome}</h1>
      <p className={estilosAdmin.suave}>Horários no fuso do salão ({fuso}).</p>

      {a === null ? (
        <EmptyState titulo={M.semAssinaturaTitulo} />
      ) : (
        <>
          <section className={estilos.secao} aria-labelledby="titulo-resumo">
            <h2 id="titulo-resumo">Resumo</h2>
            <dl className={estilos.dados}>
              <dt>Situação</dt>
              <dd>
                <SeloDaAssinatura estado={a.estado} />
              </dd>
              <dt>Vinculada ao Mercado Pago</dt>
              <dd>{a.vinculada ? 'Sim' : 'Não'}</dd>
              {campos
                .filter(([, v]) => v !== null)
                .map(([rotulo, v]) => (
                  <Par key={rotulo} rotulo={rotulo} valor={v as string} />
                ))}
            </dl>
          </section>

          <section className={estilos.secao} aria-labelledby="titulo-transicoes">
            <h2 id="titulo-transicoes">Transições</h2>
            <DataList<TransicaoDTO>
              legenda="Transições da assinatura"
              chaveDaLinha={(t) => t.id}
              linhas={dados.transicoes}
              vazio={<EmptyState titulo={M.semTransicoes} nivelTitulo={3} />}
              colunas={[
                { chave: 'quando', rotulo: 'Quando', classeCelula: estilosAdmin.celulaData, renderizar: (t) => quando(t.ocorridaEm) },
                {
                  chave: 'estados',
                  rotulo: 'De → Para',
                  classeCelula: estilosAdmin.celulaData,
                  renderizar: (t) => `${t.de === null ? '—' : rotuloDeSituacao(t.de)} → ${rotuloDeSituacao(t.para)}`,
                },
                {
                  chave: 'causa', classeCelula: estilosAdmin.celulaTexto,
                  rotulo: 'Causa',
                  renderizar: (t) => (
                    <span className={estilosAdmin.pilha}>
                      <span className={estilosAdmin.quebra}>{t.causa}</span>
                      {t.origemEvento ? <span className={estilosAdmin.apoio}>Origem: evento</span> : null}
                    </span>
                  ),
                },
              ]}
            />
          </section>

          <section className={estilos.secao} aria-labelledby="titulo-eventos">
            <h2 id="titulo-eventos">Eventos de webhook</h2>
            {dados.maisEventos ? <p className={estilosAdmin.suave}>{M.maisEventos}</p> : null}
            <DataList<EventoDTO>
              legenda="Eventos recebidos"
              chaveDaLinha={(e) => e.id}
              linhas={dados.eventos}
              vazio={<EmptyState titulo={M.semEventos} nivelTitulo={3} />}
              detalhe={(e) => <JsonLegivel valor={e.payload} />}
              colunas={[
                {
                  chave: 'recebido',
                  rotulo: 'Recebido em',
                  classeCelula: estilosAdmin.celulaTexto,
                  renderizar: (e) => (
                    <span className={estilosAdmin.pilha}>
                      <span>{quando(e.recebidoEm)}</span>
                      <span className={`${estilosAdmin.apoio} ${estilosAdmin.quebra}`}>Tipo: {e.tipo ?? '—'}</span>
                    </span>
                  ),
                },
                {
                  chave: 'resultado',
                  rotulo: 'Resultado',
                  classeCelula: estilosAdmin.celulaSelo,
                  renderizar: (e) => {
                    const s = seloDoWebhook(e.resultado);
                    return (
                      <span className={estilosAdmin.pilha}>
                        <SeloDeEstado forma={s.forma} variante={s.variante}>
                          {s.rotulo}
                        </SeloDeEstado>
                        {e.origemValida ? (
                          <span className={estilosAdmin.apoio}>Origem válida</span>
                        ) : (
                          <SeloDeEstado forma={SELO_ORIGEM_INVALIDA.forma} variante={SELO_ORIGEM_INVALIDA.variante}>
                            Origem inválida
                          </SeloDeEstado>
                        )}
                      </span>
                    );
                  },
                },
                {
                  chave: 'fim',
                  rotulo: 'Processado em / Erro',
                  classeCelula: estilosAdmin.celulaData,
                  renderizar: (e) => (
                    <span className={estilosAdmin.pilha}>
                      <span>{e.processadoEm === null ? '—' : quando(e.processadoEm)}</span>
                      {e.erro !== null ? <span className={`${estilosAdmin.apoio} ${estilosAdmin.apoioMono}`}>erro: {e.erro}</span> : null}
                    </span>
                  ),
                },
              ]}
            />
          </section>
        </>
      )}

      <p>
        <a href={hrefAuditoria} className={estilosAdmin.link}>
          Auditoria deste salão
        </a>
      </p>
    </div>
  );
}

function Par({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <>
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </>
  );
}
