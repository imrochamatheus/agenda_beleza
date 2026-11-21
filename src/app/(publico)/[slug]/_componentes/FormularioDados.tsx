'use client';

import { useActionState, useEffect, useRef, type ReactNode } from 'react';

import { CaixasConsentimento } from '@/components/consentimento/CaixasConsentimento';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { SlotGrid } from '@/components/ui/SlotGrid';
import { formatarDataHora, formatarDuracao, formatarMoeda } from '@/lib/format';
import type { DadosDoWidget } from '@/server/protecao/widget-tipos';
import { MENSAGENS_RESERVA_PUBLICA } from '@/server/reserva-publica/tipos';

import { estadoInicialReserva } from '../estado';
import type { AcaoReservar } from '../estado';
import estilos from './Salao.module.css';
import { WidgetTurnstile } from './WidgetTurnstile';
import { rotuloDoDia } from './Passos';

export type OcultosDaReserva = {
  slug: string;
  s: string[];
  p: string;
  data: string;
  profissionalId: string;
  inicio: string;
  chave: string;
};

/**
 * Passo final: nome, telefone e consentimento (D-026 RN-8..RN-11). Um único `useActionState`; funciona
 * por POST sem JavaScript (a resposta é a página com o estado da ação). O estado manda: confirmação,
 * "indisponível" ou os erros por campo com os valores digitados preservados. A mesma chave de
 * idempotência volta em toda resposta.
 */
export function FormularioDados({
  acao,
  ocultos,
  humano,
  children,
  cabecalhoReescolha,
  alternativa,
}: {
  acao: AcaoReservar;
  humano: DadosDoWidget;
  ocultos: OcultosDaReserva;
  /** Cabeçalho do passo (título, resumo, voltar): só aparece enquanto edita; a confirmação o substitui. */
  children?: ReactNode;
  /** Resumo da escolha (sem horário) mostrado quando o horário foi tomado e a cliente reescolhe (D-036 DEF-1). */
  cabecalhoReescolha?: ReactNode;
  /**
   * Passo "horário" que a página mostra quando o horário escolhido sumiu (aviso `horario_indisponivel`): sem
   * JavaScript o POST do conflito volta à página neste passo, e o estado da ação (reescolha, com os dados
   * digitados) assume; sem estado de reescolha (GET), vale esta alternativa.
   */
  alternativa?: ReactNode;
}) {
  const [estado, enviar, pendente] = useActionState(
    acao,
    estadoInicialReserva(ocultos.chave),
  );
  const foco = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (estado.status !== "editando" || estado.mensagem) foco.current?.focus();
  }, [estado]);

  if (estado.status === "confirmada" && estado.resumo) {
    const r = estado.resumo;
    return (
      <section className={estilos.reserva} aria-labelledby="reserva-titulo">
        <h2 id="reserva-titulo">Sua reserva</h2>
        <div ref={foco} tabIndex={-1} id="confirmacao">
          <Alert variante="sucesso">Reserva confirmada!</Alert>
        </div>
        <ul className={estilos.lista}>
          {r.servicos.map((s, i) => (
            <li key={i} className={estilos.item}>
              <span>{s.nome}</span>
              <span className={estilos.suave}>
                {formatarDuracao(s.duracaoMin)} ·{" "}
                {formatarMoeda(s.precoCentavos)}
              </span>
            </li>
          ))}
        </ul>
        <div className={estilos.resumo}>
          <p>Profissional: {r.profissionalNome}</p>
          <p>Quando: {formatarDataHora(new Date(r.inicioIso), r.fuso)}</p>
          <p>
            Duração: {formatarDuracao(r.duracaoTotalMin)} · Total:{" "}
            <strong>{formatarMoeda(r.totalCentavos)}</strong>
          </p>
        </div>
        <p className={estilos.suave}>
          Você receberá a confirmação por WhatsApp.
        </p>
      </section>
    );
  }

  if (estado.status === "indisponivel") {
    return (
      <section className={estilos.reserva} aria-labelledby="reserva-titulo">
        <h2 id="reserva-titulo">Sua reserva</h2>
        <div ref={foco} tabIndex={-1}>
          <Alert
            variante="aviso"
            titulo={MENSAGENS_RESERVA_PUBLICA.indisponivelTitulo}
          >
            {MENSAGENS_RESERVA_PUBLICA.indisponivelTexto}
          </Alert>
        </div>
      </section>
    );
  }

  if (alternativa && !estado.reescolha) return <>{alternativa}</>;
  const { erros, valores } = estado;
  const reescolha = estado.reescolha ?? null;
  return (
    <section className={estilos.reserva} aria-labelledby="reservar">
      {reescolha ? (
        <>
          <h2 id="reservar">Escolha o horário</h2>
          {cabecalhoReescolha}
        </>
      ) : (
        children
      )}
      <form action={enviar} className={estilos.formulario} noValidate>
        <input type="hidden" name="slug" value={ocultos.slug} />
        {ocultos.s.map((id) => (
          <input key={id} type="hidden" name="s" value={id} />
        ))}
        <input type="hidden" name="p" value={ocultos.p} />
        <input type="hidden" name="data" value={ocultos.data} />
        <input
          type="hidden"
          name="profissionalId"
          value={ocultos.profissionalId}
        />
        {reescolha ? (
          <input type="hidden" name="reescolha" value="1" />
        ) : (
          <input type="hidden" name="inicio" value={ocultos.inicio} />
        )}
        <input type="hidden" name="chave" value={estado.chave} />
        {estado.mensagem ? (
          <div ref={foco} tabIndex={-1}>
            <Alert variante="erro">{estado.mensagem}</Alert>
          </div>
        ) : null}
        {reescolha ? (
          <SlotGrid
            instantes={reescolha.horarios.map((h) => new Date(h))}
            fuso={reescolha.fuso}
            rotuloGrupo={`Horários de ${rotuloDoDia(ocultos.data)}`}
            name="inicio"
          />
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
        <CaixasConsentimento
          idPrefixo="consentimento"
          erros={erros}
          valores={valores}
        />
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
