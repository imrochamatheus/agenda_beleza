'use client';

import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { ErroDoCampo, Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { MENSAGENS_MOTIVO_ENCAIXE } from '@/server/reservas/tipos';
import type { AcoesPermitidas } from '@/server/reservas/status';

import novaEstilos from '../../nova/NovaReserva.module.css';

import estilos from './AcoesDaReserva.module.css';
import { estadoCancelarInicial, estadoMarcarInicial, estadoRemarcarInicial, idDoCampoRemarcar, MENSAGEM_DO_RESULTADO, MENSAGENS_FORMULARIO_ALTERACAO } from './estado';
import type { CampoRemarcar, EstadoCancelar, EstadoMarcar, EstadoRemarcar, ResultadoPrg, ValoresRemarcar } from './estado';

export type AcoesDaReservaProps = {
  reservaId: string;
  acoes: AcoesPermitidas;
  /** Resultado do PRG de sucesso (`?resultado=`), já validado contra a lista fechada. */
  resultado: ResultadoPrg | null;
  remarcar: {
    valores: ValoresRemarcar;
    servicos: { id: string; rotulo: string }[];
    /** Gestor: opções; null = profissional (agenda própria, fixa). */
    profissionais: { valor: string; rotulo: string }[] | null;
    profissionalFixo?: string;
  };
  /** Ações de servidor (as reais ou as da vitrine) ou, nos testes, funções equivalentes. */
  acaoRemarcar: (anterior: EstadoRemarcar, fd: FormData) => Promise<EstadoRemarcar>;
  acaoCancelar: (anterior: EstadoCancelar, fd: FormData) => Promise<EstadoCancelar>;
  acaoMarcar: (anterior: EstadoMarcar, fd: FormData) => Promise<EstadoMarcar>;
};

const ORDEM: readonly CampoRemarcar[] = ['servicos', 'profissional', 'data', 'hora'];
const ROTULOS: Record<CampoRemarcar, string> = { servicos: 'Serviços', profissional: 'Profissional', data: 'Nova data', hora: 'Nova hora' };

/**
 * Ações da reserva (D-030 CA-13): marcar o resultado, remarcar e cancelar em dois passos (sem diálogo de
 * JavaScript). Cada ação tem o seu `useActionState`, SEMPRE na mesma ordem, para a resposta do POST sem JS
 * não perder o estado. Só mostra o que a máquina de status permite agora.
 */
export function AcoesDaReserva({ reservaId, acoes, resultado, remarcar, acaoRemarcar, acaoCancelar, acaoMarcar }: AcoesDaReservaProps) {
  const [marcarEstado, marcarEnviar, marcando] = useActionState(acaoMarcar, estadoMarcarInicial);
  const [cancelarEstado, cancelarEnviar, cancelando] = useActionState(acaoCancelar, estadoCancelarInicial);
  const [remarcarEstado, remarcarEnviar, remarcando] = useActionState(acaoRemarcar, estadoRemarcarInicial(remarcar.valores));
  const aviso = useRef<HTMLDivElement>(null);
  const resumo = useRef<HTMLDivElement>(null);
  const confirmar = useRef<HTMLDivElement>(null);
  const { erros, valores, motivos } = remarcarEstado;
  const itensErro = ORDEM.filter((c) => erros[c]).map((c) => ({ href: `#${idDoCampoRemarcar(c)}`, texto: `${ROTULOS[c]}: ${erros[c]}` }));
  const pedeConfirmacao = motivos !== null && motivos.length > 0;

  useEffect(() => {
    if (itensErro.length > 0) resumo.current?.focus();
    else if (pedeConfirmacao) aviso.current?.focus();
  }, [remarcarEstado, itensErro.length, pedeConfirmacao]);
  useEffect(() => {
    if (cancelarEstado.confirmando) confirmar.current?.focus();
  }, [cancelarEstado.confirmando]);

  return (
    <div className={estilos.acoes}>
      {resultado ? (
        <p role="status" tabIndex={-1} className={estilos.resultado}>
          {MENSAGEM_DO_RESULTADO[resultado]}
        </p>
      ) : null}

      {acoes.concluir || acoes.naoCompareceu ? (
        <section className={estilos.secao} aria-labelledby="acao-situacao">
          <h2 id="acao-situacao">Situação do atendimento</h2>
          {marcarEstado.mensagem ? <Alert variante="erro">{marcarEstado.mensagem}</Alert> : null}
          <form action={marcarEnviar} className={estilos.linha}>
            <input type="hidden" name="reservaId" value={reservaId} />
            {acoes.concluir ? (
              <Button type="submit" name="para" value="concluido" ocupado={marcando} rotuloOcupado="Salvando…">
                Marcar como concluída
              </Button>
            ) : null}
            {acoes.naoCompareceu ? (
              <Button type="submit" name="para" value="nao_compareceu" variante="secundaria" ocupado={marcando} rotuloOcupado="Salvando…">
                Marcar como não compareceu
              </Button>
            ) : null}
          </form>
        </section>
      ) : null}

      {acoes.remarcar ? (
        <section className={estilos.secao} aria-labelledby="acao-remarcar">
          <h2 id="acao-remarcar">Remarcar</h2>
          <form action={remarcarEnviar} className={novaEstilos.formulario} noValidate>
            <input type="hidden" name="reservaId" value={reservaId} />
            {remarcarEstado.mensagem && !pedeConfirmacao ? <Alert variante="erro">{remarcarEstado.mensagem}</Alert> : null}
            {itensErro.length > 0 ? (
              <div ref={resumo} id="remarcar-resumo-erros" tabIndex={-1} className={novaEstilos.resumoErros} role="alert" aria-labelledby="remarcar-resumo-erros-titulo">
                <p id="remarcar-resumo-erros-titulo" className={novaEstilos.titulo}>
                  {MENSAGENS_FORMULARIO_ALTERACAO.resumoErros}
                </p>
                <ul>
                  {itensErro.map((i) => (
                    <li key={i.texto}>
                      <a href={i.href}>{i.texto}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {pedeConfirmacao ? (
              <div ref={aviso} id="remarcar-aviso-encaixe" tabIndex={-1} className={novaEstilos.aviso} role="alert" aria-labelledby="remarcar-aviso-encaixe-titulo">
                <p id="remarcar-aviso-encaixe-titulo" className={novaEstilos.titulo}>
                  Atenção: encaixe
                </p>
                <p>{remarcarEstado.mensagem}</p>
                <ul>
                  {motivos.map((m) => (
                    <li key={m}>{MENSAGENS_MOTIVO_ENCAIXE[m]}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <fieldset className={novaEstilos.grupo} id={idDoCampoRemarcar('servicos')}>
              <legend>{ROTULOS.servicos}</legend>
              <div className={novaEstilos.servicos} key={`s-${valores.servicoIds.join(',')}`}>
                {remarcar.servicos.map((s) => (
                  <Checkbox key={s.id} id={`remarcar-servico-${s.id}`} name="s" value={s.id} rotulo={s.rotulo} defaultChecked={valores.servicoIds.includes(s.id)} />
                ))}
              </div>
              {erros.servicos ? <ErroDoCampo id={`${idDoCampoRemarcar('servicos')}-erro`} texto={erros.servicos} /> : null}
            </fieldset>

            {remarcar.profissionais !== null ? (
              <Select
                id={idDoCampoRemarcar('profissional')}
                name="profissionalId"
                rotulo={ROTULOS.profissional}
                opcoes={remarcar.profissionais}
                defaultValue={valores.profissionalId}
                erro={erros.profissional}
                key={`p-${valores.profissionalId}`}
              />
            ) : (
              <div>
                <input type="hidden" name="profissionalId" value={valores.profissionalId} />
                <p className={novaEstilos.fixo} id={idDoCampoRemarcar('profissional')}>
                  <strong>{ROTULOS.profissional}:</strong> {remarcar.profissionalFixo}
                </p>
                {erros.profissional ? <ErroDoCampo id={`${idDoCampoRemarcar('profissional')}-erro`} texto={erros.profissional} /> : null}
              </div>
            )}

            <div className={novaEstilos.dataHora}>
              <Field id={idDoCampoRemarcar('data')} name="data" tipo="date" rotulo={ROTULOS.data} defaultValue={valores.data} erro={erros.data} key={`d-${valores.data}`} />
              <Field
                id={idDoCampoRemarcar('hora')}
                name="hora"
                rotulo={`${ROTULOS.hora} (HH:MM)`}
                autoComplete="off"
                maxLength={5}
                inputMode="numeric"
                pattern="([01]?[0-9]|2[0-3]):[0-5][0-9]"
                defaultValue={valores.hora}
                erro={erros.hora}
                key={`h-${valores.hora}`}
              />
            </div>

            {pedeConfirmacao ? (
              <Checkbox id="remarcar-confirmar-encaixe" name="confirmarEncaixe" rotulo="Confirmo o encaixe" defaultChecked={valores.confirmarEncaixe} key={`c-${valores.confirmarEncaixe}`} />
            ) : null}

            <div className={novaEstilos.acoes}>
              <Button type="submit" ocupado={remarcando} rotuloOcupado="Remarcando…">
                Remarcar reserva
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {acoes.cancelar ? (
        <section className={estilos.secao} aria-labelledby="acao-cancelar">
          <h2 id="acao-cancelar">Cancelar</h2>
          {cancelarEstado.mensagem ? <Alert variante="erro">{cancelarEstado.mensagem}</Alert> : null}
          <form action={cancelarEnviar} className={estilos.secao}>
            <input type="hidden" name="reservaId" value={reservaId} />
            {cancelarEstado.confirmando ? (
              <div ref={confirmar} id="cancelar-confirmacao" tabIndex={-1} className={estilos.confirmacao} role="alert">
                <p>
                  <strong>Cancelar esta reserva?</strong> O horário será liberado e a cliente será avisada, se tiver aceitado as mensagens.
                </p>
                <div className={estilos.linha}>
                  <Button type="submit" name="passo" value="cancelar" variante="perigo" ocupado={cancelando} rotuloOcupado="Cancelando…">
                    Confirmar cancelamento
                  </Button>
                  <Button type="submit" name="passo" value="voltar" variante="secundaria">
                    Manter reserva
                  </Button>
                </div>
              </div>
            ) : (
              <div className={estilos.linha}>
                <Button type="submit" name="passo" value="confirmar" variante="perigo">
                  Cancelar reserva
                </Button>
              </div>
            )}
          </form>
        </section>
      ) : null}
    </div>
  );
}
