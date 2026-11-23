import { PublicLayout } from '@/components/layout/PublicLayout';
import { Alert } from '@/components/ui/Alert';
import { camposOcultos } from '@/server/reserva-publica/passos';
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
import type { AcaoReservar, EstadoReserva } from '../estado';
import { FormularioDados } from './FormularioDados';
import { CabecalhoDados, PassoDia, PassoServico, PassoServicos } from './Passos';
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
  /** Só a vitrine `/dev/reserva`: estado inicial do formulário de dados (vistas de reescolha e confirmação). */
  estadoInicial?: EstadoReserva;
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
    case "dia":
      return <PassoDia base={base} visao={visao} />;
    case "servico":
      // Item que caiu (GET): sem JavaScript o POST do conflito, e o da confirmação, voltam à página neste passo;
      // o formulário assume com o estado da ação (D-036 DEF-1, D-050 CA-10). Sem estado, vale o passo.
      if (visao.aviso === 'horario_indisponivel' || visao.aviso === 'profissional_indisponivel') {
        return (
          <FormularioDados
            acao={props.acao}
            humano={props.humano}
            base={base}
            estadoInicial={props.estadoInicial}
            alternativa={<PassoServico base={base} visao={visao} />}
            ocultos={{ slug: props.slug, chave: props.chave, campos: camposOcultos(visao.consulta) }}
          />
        );
      }
      return <PassoServico base={base} visao={visao} />;
    case "dados":
      return (
        <FormularioDados
          acao={props.acao}
          humano={props.humano}
          base={base}
          estadoInicial={props.estadoInicial}
          ocultos={{ slug: props.slug, chave: props.chave, campos: camposOcultos(visao.consulta) }}
        >
          <CabecalhoDados base={base} visao={visao} />
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
