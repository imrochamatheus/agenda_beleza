import { PublicLayout } from '@/components/layout/PublicLayout';
import { Alert } from '@/components/ui/Alert';
import { montarHref, QUALQUER } from '@/server/reserva-publica/passos';
import { MENSAGENS_RESERVA_PUBLICA } from '@/server/reserva-publica/tipos';
import type { DecisaoAgendamento } from '@/server/reserva-publica/agendamento';
import type { VisaoDoPasso } from '@/server/reserva-publica/tipos';
import type { DadosDoWidget } from '@/server/protecao/widget-tipos';
import { MENSAGENS_PROTECAO } from '@/server/protecao/tipos';
import type { FotoPublica } from '@/server/fotos/tipos';
import type {
  PerfilPublico,
  ProfissionalPublico,
  ServicoPublico,
} from "@/server/repos/publico";

import type { AvaliacoesPublicas } from '@/server/avaliacoes/tipos';

import type { AcaoDenunciar } from '../_denuncia/estado';
import type { AcaoReservar } from '../estado';
import { FormularioDados } from './FormularioDados';
import {
  PassoData,
  PassoHorario,
  PassoProfissional,
  PassoServicos,
  ResumoDaSelecao,
} from "./Passos";
import {
  Descricao,
  Equipe,
  Fotos,
  ListaDeServicos,
  SecoesDoPerfil,
} from "./Perfil";
import { SecaoAvaliacoes } from './SecaoAvaliacoes';
import estilos from './Salao.module.css';

export type PaginaDoSalaoProps = {
  /** Caminho da página (GET dos passos): `/<slug>` ou `/dev/reserva`. */
  base: string;
  slug: string;
  perfil: PerfilPublico;
  fotos: readonly FotoPublica[];
  servicos: readonly ServicoPublico[];
  equipe: readonly ProfissionalPublico[];
  decisao: DecisaoAgendamento;
  visao: VisaoDoPasso;
  /** UUID novo por renderização do passo `dados` (idempotência contra duplo envio). */
  chave: string;
  acao: AcaoReservar;
  /** Widget de verificação humana da etapa de dados (D-027). */
  humano: DadosDoWidget;
  /** Avaliações verificadas (D-032); ausente na vitrine de reserva. */
  avaliacoes?: AvaliacoesPublicas;
  /** Denúncia de avaliação (D-035); ausente na vitrine de reserva. */
  denuncia?: { acao: AcaoDenunciar; recebida: boolean };
};

function PassoAtual({ props }: { props: PaginaDoSalaoProps }) {
  const { base, visao, servicos } = props;
  switch (visao.passo) {
    case "limitado":
      return (
        <section className={estilos.secao} aria-labelledby="limitado">
          <Alert variante="aviso">
            <span id="limitado">{MENSAGENS_PROTECAO.limitado}</span>
          </Alert>
        </section>
      );
    case "servicos":
      return <PassoServicos base={base} servicos={servicos} visao={visao} />;
    case "profissional":
      return <PassoProfissional base={base} visao={visao} />;
    case "data":
      return <PassoData base={base} visao={visao} />;
    case "horario":
      // Horário tomado: sem JavaScript o POST volta aqui; o formulário assume com o estado da ação (DEF-1).
      if (visao.aviso === 'horario_indisponivel') {
        return (
          <FormularioDados
            acao={props.acao}
            humano={props.humano}
            alternativa={<PassoHorario base={base} visao={visao} />}
            cabecalhoReescolha={<ResumoDaSelecao selecao={visao.selecao} />}
            ocultos={{ slug: props.slug, s: visao.s, p: visao.p, data: visao.data, profissionalId: '', inicio: '', chave: props.chave }}
          />
        );
      }
      return <PassoHorario base={base} visao={visao} />;
    case "dados":
      return (
        <FormularioDados
          acao={props.acao}
          humano={props.humano}
          cabecalhoReescolha={<ResumoDaSelecao selecao={visao.selecao} profissional={visao.p === QUALQUER ? undefined : visao.profissional.nome} />}
          ocultos={{
            slug: props.slug,
            s: visao.s,
            p: visao.p,
            data: visao.data,
            profissionalId: visao.profissional.id,
            inicio: visao.inicioIso,
            chave: props.chave,
          }}
        >
          <h2 id="reservar">Seus dados</h2>
          <ResumoDaSelecao
            selecao={visao.selecao}
            profissional={visao.profissional.nome}
            inicioIso={visao.inicioIso}
            fuso={visao.fuso}
          />
          <ul className={estilos.navegacao}>
            <li>
              <a
                href={montarHref(base, {
                  s: visao.s,
                  p: visao.p,
                  data: visao.data,
                })}
              >
                Escolher outro horário
              </a>
            </li>
          </ul>
        </FormularioDados>
      );
  }
}

/**
 * Página pública do salão (D-026 CA-1, CA-2): perfil por seções (campo vazio omite a seção), fluxo de
 * reserva por query string e, sem condição de reservar, o aviso "Agendamento indisponível" sem
 * formulário. O mesmo componente serve a página real e a vitrine /dev/reserva.
 */
export function PaginaDoSalao(props: PaginaDoSalaoProps) {
  const { perfil, decisao, visao } = props;
  const noPrimeiroPasso = visao.passo === "servicos";
  return (
    <PublicLayout variante="salao" nomeSalao={perfil.nome}>
      <div className={estilos.pagina}>
        <h1>{perfil.nome}</h1>
        <Fotos fotos={props.fotos} />
        <Descricao texto={perfil.descricao} />
        {decisao.disponivel ? (
          <PassoAtual props={props} />
        ) : (
          <section className={estilos.secao} aria-labelledby="indisponivel">
            <Alert
              variante="aviso"
              titulo={MENSAGENS_RESERVA_PUBLICA.indisponivelTitulo}
            >
              <span id="indisponivel">
                {MENSAGENS_RESERVA_PUBLICA.indisponivelTexto}
              </span>
            </Alert>
          </section>
        )}
        {!decisao.disponivel || !noPrimeiroPasso ? (
          <ListaDeServicos servicos={props.servicos} />
        ) : null}
        <Equipe equipe={props.equipe} />
        {props.avaliacoes ? (
          <SecaoAvaliacoes
            avaliacoes={props.avaliacoes}
            denuncia={props.denuncia ? { ...props.denuncia, slug: props.slug, humano: props.humano } : undefined}
          />
        ) : null}
        <SecoesDoPerfil perfil={perfil} />
      </div>
    </PublicLayout>
  );
}
