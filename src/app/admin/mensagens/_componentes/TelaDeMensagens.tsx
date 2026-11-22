import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { DataList } from '@/components/ui/DataList';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { formatarInteiro } from '@/lib/format';
import { MENSAGENS_REENVIO, TEXTO_FILTRO_INVALIDO } from '@/server/admin/mensagens-tipos';
import type { CodigoReenvio, ListaMensagens, MensagemAdminDTO, TentativaAdminDTO } from '@/server/admin/mensagens-tipos';
import { haFiltroNaFila, hrefDaFila } from '@/server/admin/mensagens-validacao';
import { ESTADOS_MENSAGEM, TIPOS_MENSAGEM, rotuloDoTipo, seloDaMensagem } from '@/server/admin/rotulos-admin';
import type { Selo } from '@/server/admin/rotulos-admin';
import { rotuloDaMensagem } from '@/server/mensagens/rotulos';

import estilosAdmin from '../../_componentes/Admin.module.css';
import { CampoDeSalao, FiltrosGet, PaginacaoAdmin, ResumoDaLista } from '../../_componentes/FiltrosGet';
import { SeloDeEstado } from '../../_componentes/SeloDeEstado';
import { avisoDeFusoGlobal, quandoGlobal } from '../../_componentes/quando';
import estilos from './Mensagens.module.css';

export type ConfirmacaoDeReenvio = { mensagem: MensagemAdminDTO } | { indisponivel: true };

export type TelaDeMensagensProps = {
  lista: ListaMensagens;
  /** Caminho da própria tela (GET dos filtros, paginação, "Cancelar"). */
  base: string;
  hrefDoSalao: (id: string) => string;
  /** Campos ocultos dos filtros (a vitrine usa `vista`). */
  ocultos?: Record<string, string>;
  /** `?reenvio=` já validado contra a lista fechada (PRG). */
  reenvio: CodigoReenvio | null;
  /** `?confirmar=<id>`: a mensagem a confirmar, ou "indisponível" (não está mais `falhou`). */
  confirmacao: ConfirmacaoDeReenvio | null;
  /** `?detalhe=<id>`. */
  detalhe: { mensagem: MensagemAdminDTO; tentativas: TentativaAdminDTO[] } | null;
  /** Server action (reais) ou de demonstração: recebe o FormData do POST "Confirmar reenvio". */
  acaoReenviar: (formData: FormData) => Promise<void>;
};

const OPCOES_ESTADO = ESTADOS_MENSAGEM.map((e) => ({ valor: e, rotulo: seloDaMensagem(e).rotulo }));
const OPCOES_TIPO = TIPOS_MENSAGEM.map((t) => ({ valor: t, rotulo: rotuloDoTipo(t) }));

function Selo2({ selo }: { selo: Selo }) {
  return (
    <SeloDeEstado forma={selo.forma} variante={selo.variante}>
      {selo.rotulo}
    </SeloDeEstado>
  );
}

function Para({ valor }: { valor: string }) {
  return valor === 'Cliente removida' ? <span className={estilos.removida}>{valor}</span> : <>{valor}</>;
}

const frase = (m: MensagemAdminDTO): string =>
  rotuloDaMensagem({ tipo: m.tipo, revisao: m.revisao, estado: m.estado, erroCodigo: m.erroCodigo }).rotulo;

function textoDoResumo(l: ListaMensagens, nomeDoSalao: string | null): string {
  const n = l.itens.length;
  const partes = [`${formatarInteiro(n)} de ${formatarInteiro(l.total)} ${l.total === 1 ? 'mensagem' : 'mensagens'}`];
  if (l.filtros.estado !== null) partes.push(`Situação: ${seloDaMensagem(l.filtros.estado).rotulo}`);
  if (l.filtros.tipo !== null) partes.push(`Tipo: ${rotuloDoTipo(l.filtros.tipo)}`);
  if (l.filtros.salaoId !== null) partes.push(`Salão: ${nomeDoSalao ?? l.filtros.salaoId}`);
  return partes.join(' · ');
}

function nomeDoSalaoFiltrado(l: ListaMensagens): string | null {
  if (l.filtros.salaoId === null || l.salao.modo !== 'select') return null;
  return l.salao.opcoes.find((o) => o.id === l.filtros.salaoId)?.nome ?? null;
}

/**
 * Corpo da tela "Mensagens" (D-045, web-design §5.2): filtros por GET, resultado do reenvio, confirmação em duas
 * etapas, tentativas, a lista (`DataList`) e a paginação. Os MESMOS componentes servem a página real e a
 * vitrine `/dev/admin-mensagens`. Nunca recebe telefone completo, parâmetros nem nome de cliente.
 */
export function TelaDeMensagens({ lista, base, hrefDoSalao, ocultos, reenvio, confirmacao, detalhe, acaoReenviar }: TelaDeMensagensProps) {
  const { filtros } = lista;
  const hrefPagina = (p: number) => hrefDaFila(base, filtros, p);
  const volta = hrefDaFila(base, filtros, filtros.pagina);
  const ativo = haFiltroNaFila(filtros);
  const alerta = reenvio === null ? null : MENSAGENS_REENVIO[reenvio];
  const vazioSemFiltro = lista.total === 0 && !ativo;
  return (
    <div className={estilosAdmin.pagina}>
      <p className={estilosAdmin.suave}>{avisoDeFusoGlobal()}</p>

      <FiltrosGet rotulo="Filtrar mensagens" base={base} ocultos={ocultos} ativo={ativo}>
        <Select name="estado" rotulo="Situação" textoVazio="Todas" defaultValue={filtros.estado ?? ''} opcoes={OPCOES_ESTADO} />
        <CampoDeSalao filtro={lista.salao} valor={filtros.salaoId} />
        <Select name="tipo" rotulo="Tipo" textoVazio="Todos" defaultValue={filtros.tipo ?? ''} opcoes={OPCOES_TIPO} />
      </FiltrosGet>

      <ResumoDaLista texto={textoDoResumo(lista, nomeDoSalaoFiltrado(lista))} />

      {lista.ignorados ? <Alert variante="info">{TEXTO_FILTRO_INVALIDO}</Alert> : null}
      {alerta !== null ? <Alert variante={alerta.variante}>{alerta.texto}</Alert> : null}

      {confirmacao !== null ? (
        'indisponivel' in confirmacao ? (
          <Alert variante="info">Esta mensagem não está mais com falha.</Alert>
        ) : (
          <section id="confirmar" aria-labelledby="confirmar-titulo" className={estilos.bloco}>
            <h2 id="confirmar-titulo">Reenviar esta mensagem?</h2>
            <dl className={estilos.dados}>
              <dt>Mensagem</dt>
              <dd>{rotuloDoTipo(confirmacao.mensagem.tipo, confirmacao.mensagem.revisao)}</dd>
              <dt>Salão</dt>
              <dd>{confirmacao.mensagem.salaoNome}</dd>
              <dt>Para</dt>
              <dd>
                <Para valor={confirmacao.mensagem.paraMascarado} />
              </dd>
              <dt>Situação</dt>
              <dd>
                <Selo2 selo={seloDaMensagem(confirmacao.mensagem.estado)} />
              </dd>
            </dl>
            <Alert variante="aviso">
              Será enviada uma nova mensagem por WhatsApp para esta cliente. Se a anterior chegou, ela receberá duas.
            </Alert>
            <form action={acaoReenviar} method="post" className={estilos.acoesConfirmar}>
              <input type="hidden" name="mensagemId" value={confirmacao.mensagem.id} />
              {filtros.estado !== null ? <input type="hidden" name="estado" value={filtros.estado} /> : null}
              {filtros.tipo !== null ? <input type="hidden" name="tipo" value={filtros.tipo} /> : null}
              {filtros.salaoId !== null ? <input type="hidden" name="salao" value={filtros.salaoId} /> : null}
              {filtros.pagina > 1 ? <input type="hidden" name="pagina" value={String(filtros.pagina)} /> : null}
              <Button type="submit" variante="primaria">
                Confirmar reenvio
              </Button>
              <a href={volta} className={estilosAdmin.link}>
                Cancelar
              </a>
            </form>
          </section>
        )
      ) : null}

      {detalhe !== null ? (
        <section id="detalhe" aria-labelledby="detalhe-titulo" className={`${estilos.bloco} ${estilos.blocoLargo}`}>
          <h2 id="detalhe-titulo">Tentativas de {frase(detalhe.mensagem).charAt(0).toLowerCase() + frase(detalhe.mensagem).slice(1)}</h2>
          <DataList<TentativaAdminDTO>
            legenda="Tentativas"
            chaveDaLinha={(t) => String(t.numero)}
            linhas={detalhe.tentativas}
            vazio={<EmptyState titulo="Nenhuma tentativa registrada" nivelTitulo={3} />}
            colunas={[
              { chave: 'numero', rotulo: 'Nº', renderizar: (t) => t.numero },
              { chave: 'inicio', rotulo: 'Início', renderizar: (t) => quandoGlobal(t.iniciadaEm) },
              { chave: 'fim', rotulo: 'Fim', renderizar: (t) => (t.finalizadaEm === null ? '—' : quandoGlobal(t.finalizadaEm)) },
              {
                chave: 'resultado',
                rotulo: 'Resultado',
                classeCelula: estilosAdmin.celulaSelo,
                renderizar: (t) =>
                  t.resultado === 'sucesso' ? (
                    <SeloDeEstado forma="circulo" variante="sucesso">
                      Sucesso
                    </SeloDeEstado>
                  ) : t.resultado === 'falha' ? (
                    <SeloDeEstado forma="triangulo" variante="erro">
                      Falha
                    </SeloDeEstado>
                  ) : (
                    <SeloDeEstado forma="relogio" variante="aviso">
                      Em andamento
                    </SeloDeEstado>
                  ),
              },
              { chave: 'codigo', rotulo: 'Código', renderizar: (t) => t.erroCodigo ?? '—' },
            ]}
          />
          <p>
            <a href={volta} className={estilosAdmin.link}>
              Voltar à lista
            </a>
          </p>
        </section>
      ) : null}

      <DataList<MensagemAdminDTO>
        legenda="Fila de mensagens"
        chaveDaLinha={(m) => m.id}
        linhas={lista.itens}
        vazio={
          lista.total > 0 ? (
            <EmptyState
              titulo="Nenhuma mensagem nesta página"
              descricao="A página pedida está além do fim da lista."
              acao={
                <a href={hrefDaFila(base, filtros, 1)} className={estilosAdmin.link}>
                  Ir para a primeira página
                </a>
              }
            />
          ) : (
            <EmptyState
              titulo={vazioSemFiltro ? 'A fila está vazia.' : 'Nenhuma mensagem encontrada'}
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
            // Quatro dados numa célula composta (tipo, salão, destinatário, data): com o menu lateral, 768 px dá
            // ~500 px ao conteúdo e uma coluna por dado estourava a tabela (web-design §2).
            chave: 'mensagem', classeCelula: estilosAdmin.celulaTexto,
            rotulo: 'Mensagem',
            renderizar: (m) => (
              <span className={estilosAdmin.pilha}>
                <span>{rotuloDoTipo(m.tipo, m.revisao)}</span>
                <a href={hrefDoSalao(m.salaoId)} className={`${estilosAdmin.apoio} ${estilosAdmin.quebra}`}>
                  {m.salaoNome}
                </a>
                <span className={estilosAdmin.apoio}>
                  Para: <Para valor={m.paraMascarado} />
                </span>
                <span className={estilosAdmin.apoio}>Criada em {quandoGlobal(m.criadaEm)}</span>
                {m.enviadaEm !== null ? <span className={estilosAdmin.apoio}>Enviada em {quandoGlobal(m.enviadaEm)}</span> : null}
              </span>
            ),
          },
          {
            chave: 'situacao',
            rotulo: 'Situação',
            classeCelula: estilosAdmin.celulaSelo,
            renderizar: (m) => (
              <span className={estilosAdmin.pilha}>
                <Selo2 selo={seloDaMensagem(m.estado)} />
                {m.erroCodigo !== null ? <span className={`${estilosAdmin.apoio} ${estilosAdmin.apoioMono}`}>código: {m.erroCodigo}</span> : null}
                <span className={estilos.acoesLinha} id={`m-${m.id}`}>
                  <a href={`${hrefDaFila(base, filtros, filtros.pagina, { detalhe: m.id })}#detalhe`} className={estilosAdmin.link}>
                    Tentativas
                  </a>
                  {m.estado === 'falhou' ? (
                    <a href={`${hrefDaFila(base, filtros, filtros.pagina, { confirmar: m.id })}#confirmar`} className={estilosAdmin.botaoLink}>
                      Reenviar
                    </a>
                  ) : null}
                </span>
              </span>
            ),
          },
        ]}
      />

      <PaginacaoAdmin pagina={lista.pagina} paginas={lista.paginas} href={hrefPagina} />
    </div>
  );
}
