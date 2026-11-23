'use client';

import { useActionState, useEffect, useRef, type ReactNode } from 'react';

import { CaixasConsentimento } from '@/components/consentimento/CaixasConsentimento';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { RoteiroDoDia } from '@/components/ui/RoteiroDoDia';
import type { ParadaDoRoteiro } from '@/components/ui/RoteiroDoDia';
import { formatarHora, formatarMoeda } from '@/lib/format';
import type { DadosDoWidget } from '@/server/protecao/widget-tipos';
import { hrefOutroDia, hrefSeguirSem } from '@/server/reserva-publica/passos';
import { MENSAGENS_PASSO, MENSAGENS_RESERVA_PUBLICA } from '@/server/reserva-publica/tipos';
import type { ResumoConfirmacao } from '@/server/reserva-publica/tipos';

import { estadoInicialReserva } from '../estado';
import type { AcaoReservar, EstadoReserva, ReescolhaNoEstado } from '../estado';
import { CamposOcultos, GradesPorProfissional, paradaDoItem, rotuloDoDia, Total } from './Passos';
import estilos from './Salao.module.css';
import { WidgetTurnstile } from './WidgetTurnstile';

export type OcultosDaReserva = {
  slug: string;
  /** UUID de idempotência da renderização (o estado da ação o mantém nas respostas). */
  chave: string;
  /** `s`, `data` e todos os `h<k>` do passo de dados (`camposOcultos(visao.consulta)`). */
  campos: readonly { name: string; value: string }[];
};

/** Intervalo entre paradas a partir do qual a confirmação lembra que dá para sair do salão (ND-4). */
const INTERVALO_LONGO_MS = 30 * 60_000;

function Confirmacao({ resumo }: { resumo: ResumoConfirmacao }) {
  const paradas: ParadaDoRoteiro[] = resumo.itens.map((i, k) => ({
    chave: `confirmado-${k}`,
    hora: formatarHora(new Date(i.inicioIso), resumo.fuso),
    fim: formatarHora(new Date(i.fimIso), resumo.fuso),
    servico: i.servicoNome,
    profissional: i.profissionalNome,
    detalhe: formatarMoeda(i.precoCentavos),
    estado: 'escolhida',
  }));
  const intervaloLongo = resumo.itens.some(
    (i, k) => k > 0 && new Date(i.inicioIso).getTime() - new Date(resumo.itens[k - 1].fimIso).getTime() >= INTERVALO_LONGO_MS,
  );
  return (
    <>
      <RoteiroDoDia
        rotulo="Seu dia"
        titulo={rotuloDoDia(resumo.data)}
        paradas={paradas}
        rodape={<Total centavos={resumo.totalCentavos} quantidade={resumo.itens.length} />}
      />
      <p className={estilos.suave}>Você receberá a confirmação por WhatsApp, com todos os horários.</p>
      {intervaloLongo ? (
        <p className={estilos.suave}>
          Entre um serviço e outro você pode sair do salão: chegue alguns minutos antes de cada horário.
        </p>
      ) : null}
    </>
  );
}

/** Roteiro da reescolha (§5.6): itens mantidos (sem "Alterar") e os abertos em destaque, por horário. */
function paradasDaReescolha(r: ReescolhaNoEstado): ParadaDoRoteiro[] {
  const mantidas = r.mantidos.map((i) => ({ inicio: i.inicioIso, parada: paradaDoItem(i, r.fuso) }));
  const abertas = r.itens.map((i) => ({
    inicio: i.horarioAnteriorIso,
    parada: {
      chave: `item-${i.indice}`,
      hora: null,
      servico: i.servicoNome,
      detalhe: 'escolha um novo horário abaixo',
      estado: 'destaque',
    } satisfies ParadaDoRoteiro,
  }));
  return [...mantidas, ...abertas].sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0)).map((x) => x.parada);
}

/** Campos ocultos do reenvio da reescolha: serviços, dia, itens mantidos e os índices reabertos. */
function ocultosDaReescolha(r: ReescolhaNoEstado): { name: string; value: string }[] {
  const abertos = new Set(r.itens.map((i) => i.indice));
  const campos = (r.consulta.s ?? []).map((id) => ({ name: 's', value: id }));
  campos.push({ name: 'data', value: r.data });
  (r.consulta.h ?? []).forEach((v, k) => {
    if (v && !abertos.has(k)) campos.push({ name: `h${k}`, value: v });
  });
  for (const k of abertos) campos.push({ name: 'reabrir', value: String(k) });
  return campos;
}

/** Grades de cada item aberto; sem horário restante, as saídas "Escolher outro dia" e "Seguir sem X". */
function GradesDaReescolha({ base, r }: { base: string; r: ReescolhaNoEstado }) {
  const varios = r.itens.length > 1;
  return (
    <>
      {r.itens.map((i) => {
        const semHorario = i.profissionais.every((p) => p.horarios.length === 0);
        return (
          <div key={i.indice} className={estilos.blocoReescolha}>
            {varios ? <h3>{MENSAGENS_PASSO.reescolhaBloco(i.servicoNome)}</h3> : null}
            {semHorario ? (
              <EmptyState
                nivelTitulo={3}
                titulo={MENSAGENS_PASSO.reescolhaSemHorarioTitulo(i.servicoNome)}
                descricao={
                  <>
                    <p>{MENSAGENS_PASSO.reescolhaSemHorarioTexto}</p>
                    <ul className={estilos.navegacao}>
                      <li>
                        <a href={hrefOutroDia(base, r.consulta)}>Escolher outro dia</a>
                      </li>
                      <li>
                        <a href={hrefSeguirSem(base, r.consulta, i.indice)}>Seguir sem {i.servicoNome}</a>
                      </li>
                    </ul>
                  </>
                }
              />
            ) : (
              <GradesPorProfissional
                profissionais={i.profissionais}
                fuso={r.fuso}
                name={`h${i.indice}`}
                preSelecionado={i.preSelecionado}
                nivel={varios ? 4 : 3}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Passo final: nome, telefone e consentimento (D-026 RN-8..RN-11; D-050 §5.4–5.6). Um único `useActionState`;
 * funciona por POST sem JavaScript (a resposta é a página com o estado da ação). O estado manda: confirmação,
 * "indisponível", reescolha dos itens que caíram ou os erros por campo com os valores digitados preservados.
 * A mesma chave de idempotência volta em toda resposta.
 */
export function FormularioDados({
  acao,
  ocultos,
  humano,
  base,
  children,
  alternativa,
  estadoInicial,
}: {
  acao: AcaoReservar;
  humano: DadosDoWidget;
  ocultos: OcultosDaReserva;
  /** Caminho da página (links "Escolher outro dia" e "Seguir sem X" da reescolha). */
  base: string;
  /** Cabeçalho do passo (título, roteiro, total): só enquanto edita sem reescolha. */
  children?: ReactNode;
  /**
   * Passo que a página mostra quando o item escolhido sumiu (GET): sem JavaScript o POST do conflito volta à
   * página nesse passo, e o estado da ação (reescolha ou confirmação) assume; sem estado, vale esta alternativa.
   */
  alternativa?: ReactNode;
  /** Só a vitrine `/dev/reserva` (vistas de reescolha e confirmação); a página real nunca passa. */
  estadoInicial?: EstadoReserva;
}) {
  const [estado, enviar, pendente] = useActionState(acao, estadoInicial ?? estadoInicialReserva(ocultos.chave));
  const foco = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (estado.status !== 'editando' || estado.mensagem) foco.current?.focus();
  }, [estado]);

  if (estado.status === 'confirmada' && estado.resumo) {
    return (
      <section className={estilos.reserva} aria-labelledby="reserva-titulo">
        <h2 id="reserva-titulo">Sua reserva</h2>
        <div ref={foco} tabIndex={-1} id="confirmacao">
          <Alert variante="sucesso">{estado.repetida ? 'Esta reserva já estava confirmada.' : 'Reserva confirmada!'}</Alert>
        </div>
        <Confirmacao resumo={estado.resumo} />
      </section>
    );
  }

  if (estado.status === 'indisponivel') {
    return (
      <section className={estilos.reserva} aria-labelledby="reserva-titulo">
        <h2 id="reserva-titulo">Sua reserva</h2>
        <div ref={foco} tabIndex={-1}>
          <Alert variante="aviso" titulo={MENSAGENS_RESERVA_PUBLICA.indisponivelTitulo}>
            {MENSAGENS_RESERVA_PUBLICA.indisponivelTexto}
          </Alert>
        </div>
      </section>
    );
  }

  const reescolha = estado.reescolha ?? null;
  if (alternativa && !reescolha) return <>{alternativa}</>;
  const { erros, valores } = estado;
  const titulo =
    reescolha === null
      ? null
      : reescolha.itens.length === 1
        ? MENSAGENS_PASSO.reescolhaTituloUm(reescolha.itens[0].servicoNome)
        : MENSAGENS_PASSO.reescolhaTituloVarios;
  return (
    <section className={estilos.reserva} aria-labelledby="reservar">
      {reescolha ? <h2 id="reservar">{titulo}</h2> : children}
      <form action={enviar} className={estilos.formulario} noValidate>
        <input type="hidden" name="slug" value={ocultos.slug} />
        <CamposOcultos campos={reescolha ? ocultosDaReescolha(reescolha) : ocultos.campos} />
        <input type="hidden" name="chave" value={estado.chave} />
        {estado.mensagem ? (
          <div ref={foco} tabIndex={-1}>
            <Alert variante={estado.status === 'horario_indisponivel' ? 'aviso' : 'erro'}>{estado.mensagem}</Alert>
          </div>
        ) : null}
        {reescolha ? (
          <>
            <RoteiroDoDia rotulo="Seu dia" titulo={rotuloDoDia(reescolha.data)} paradas={paradasDaReescolha(reescolha)} />
            <GradesDaReescolha base={base} r={reescolha} />
          </>
        ) : null}
        <Field
          rotulo="Nome"
          name="nome"
          autoComplete="name"
          obrigatorio
          maxLength={100}
          defaultValue={valores.nome}
          erro={erros.nome}
        />
        <Field
          rotulo="Telefone (com DDD)"
          name="telefone"
          tipo="tel"
          autoComplete="tel"
          inputMode="tel"
          obrigatorio
          maxLength={30}
          defaultValue={valores.telefone}
          erro={erros.telefone}
        />
        <CaixasConsentimento idPrefixo="consentimento" erros={erros} valores={valores} />
        <WidgetTurnstile dados={humano} />
        <div className={estilos.acoes}>
          <Button type="submit" ocupado={pendente} rotuloOcupado="Reservando…">
            Confirmar reserva
          </Button>
        </div>
      </form>
    </section>
  );
}
