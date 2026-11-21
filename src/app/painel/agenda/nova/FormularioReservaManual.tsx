'use client';

import { Fragment, useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { ErroDoCampo, Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { ROTAS } from '@/config/navegacao';
import { CAMPOS_CONSENTIMENTO, TEXTOS_CONSENTIMENTO } from '@/config/termos';
import { MENSAGENS_MOTIVO_ENCAIXE, MENSAGENS_RESERVA_EQUIPE } from '@/server/reservas/tipos';

import { idDoCampo, MENSAGENS_FORMULARIO_RESERVA } from './estado';
import type { CampoReservaManual, EstadoReservaManual } from './estado';
import estilos from './NovaReserva.module.css';

export type ServicoDoFormulario = { id: string; rotulo: string };

export type FormularioReservaManualProps = {
  /** Ação de servidor (a real ou a de demonstração) ou, nos testes, uma função equivalente. */
  acao: (anterior: EstadoReservaManual, formData: FormData) => Promise<EstadoReservaManual>;
  estadoInicial: EstadoReservaManual;
  servicos: ServicoDoFormulario[];
  /** Gestor: opções do profissional; null = profissional (agenda própria, fixa). */
  profissionais: { valor: string; rotulo: string }[] | null;
  /** Profissional: nome mostrado no lugar do seletor. */
  profissionalFixo?: string;
};

const ORDEM: readonly CampoReservaManual[] = ['servicos', 'profissional', 'data', 'hora', 'nome', 'telefone'];
const ROTULOS: Record<CampoReservaManual, string> = {
  servicos: 'Serviços',
  profissional: 'Profissional',
  data: 'Data',
  hora: 'Hora',
  nome: 'Nome da cliente',
  telefone: 'Telefone (WhatsApp)',
};
const ID_RESUMO = 'reserva-resumo-erros';
const ID_AVISO = 'reserva-aviso-encaixe';
const ID_CRIADA = 'reserva-criada';

/**
 * Formulário de reserva manual da equipe (D-029; RN-1..RN-11). Funciona sem JavaScript
 * (useActionState): o aviso de encaixe e os erros voltam na própria resposta, com todos os dados
 * preservados; a caixa "Confirmo o encaixe" só aparece quando há motivo. O foco vai ao resumo de erros,
 * ao aviso de encaixe ou ao resultado.
 */
export function FormularioReservaManual({ acao, estadoInicial, servicos, profissionais, profissionalFixo }: FormularioReservaManualProps) {
  const [estado, enviar, pendente] = useActionState(acao, estadoInicial);
  const resumo = useRef<HTMLDivElement>(null);
  const aviso = useRef<HTMLDivElement>(null);
  const criada = useRef<HTMLDivElement>(null);
  const { erros, valores, motivos } = estado;
  const itens = ORDEM.filter((c) => erros[c]).map((c) => ({
    href: `#${idDoCampo(c === 'servicos' ? 'servicos' : c)}`,
    texto: `${ROTULOS[c]}: ${erros[c]}`,
  }));
  const temErros = itens.length > 0;
  const pedeConfirmacao = motivos !== null && motivos.length > 0;

  useEffect(() => {
    if (temErros) resumo.current?.focus();
    else if (pedeConfirmacao) aviso.current?.focus();
    else if (estado.criada) criada.current?.focus();
  }, [estado, temErros, pedeConfirmacao]);

  return (
    <form action={enviar} className={estilos.formulario} noValidate>
      <input type="hidden" name="chave" value={estado.chave} />
      {estado.mensagem && !pedeConfirmacao ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
      {temErros ? (
        <div ref={resumo} id={ID_RESUMO} tabIndex={-1} className={estilos.resumoErros} role="alert" aria-labelledby={`${ID_RESUMO}-titulo`}>
          <p id={`${ID_RESUMO}-titulo`} className={estilos.titulo}>
            {MENSAGENS_FORMULARIO_RESERVA.resumoErros}
          </p>
          <ul>
            {itens.map((item) => (
              <li key={item.texto}>
                <a href={item.href}>{item.texto}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {pedeConfirmacao ? (
        <div ref={aviso} id={ID_AVISO} tabIndex={-1} className={estilos.aviso} role="alert" aria-labelledby={`${ID_AVISO}-titulo`}>
          <p id={`${ID_AVISO}-titulo`} className={estilos.titulo}>
            Atenção: encaixe
          </p>
          <p>{estado.mensagem}</p>
          <ul>
            {motivos.map((m) => (
              <li key={m}>{MENSAGENS_MOTIVO_ENCAIXE[m]}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {estado.criada && !temErros ? (
        <div ref={criada} id={ID_CRIADA} tabIndex={-1} className={estilos.criada} role="status" aria-labelledby={`${ID_CRIADA}-titulo`}>
          <p id={`${ID_CRIADA}-titulo`} className={estilos.titulo}>
            {estado.criada.repetida
              ? MENSAGENS_FORMULARIO_RESERVA.repetida
              : estado.criada.encaixe
                ? MENSAGENS_FORMULARIO_RESERVA.criadaEncaixe
                : MENSAGENS_FORMULARIO_RESERVA.criada}
          </p>
          <a className={estilos.link} href={estado.criada.hrefAgenda}>
            Ver na agenda
          </a>
        </div>
      ) : null}

      <fieldset className={estilos.grupo} id={idDoCampo('servicos')} aria-describedby={erros.servicos ? `${idDoCampo('servicos')}-erro` : undefined}>
        <legend>{ROTULOS.servicos}</legend>
        <p className={estilos.ajuda}>Escolha de um a dez serviços, atendidos em sequência pelo mesmo profissional.</p>
        <div className={estilos.servicos} key={`s-${valores.servicoIds.join(',')}`}>
          {servicos.map((s) => (
            <Checkbox key={s.id} id={`reserva-servico-${s.id}`} name="s" value={s.id} rotulo={s.rotulo} defaultChecked={valores.servicoIds.includes(s.id)} />
          ))}
        </div>
        {erros.servicos ? <ErroDoCampo id={`${idDoCampo('servicos')}-erro`} texto={erros.servicos} /> : null}
      </fieldset>

      {profissionais !== null ? (
        <Select
          id={idDoCampo('profissional')}
          name="profissionalId"
          rotulo={ROTULOS.profissional}
          textoVazio="Escolha…"
          opcoes={profissionais}
          defaultValue={valores.profissionalId}
          erro={erros.profissional}
          key={`p-${valores.profissionalId}`}
        />
      ) : (
        <div>
          <input type="hidden" name="profissionalId" value={valores.profissionalId} />
          <p className={estilos.fixo} id={idDoCampo('profissional')}>
            <strong>{ROTULOS.profissional}:</strong> {profissionalFixo}
          </p>
          {erros.profissional ? <ErroDoCampo id={`${idDoCampo('profissional')}-erro`} texto={erros.profissional} /> : null}
        </div>
      )}

      <div className={estilos.dataHora}>
        <Field
          id={idDoCampo('data')}
          name="data"
          tipo="date"
          rotulo={ROTULOS.data}
          defaultValue={valores.data}
          erro={erros.data}
          key={`d-${valores.data}`}
        />
        <Field
          id={idDoCampo('hora')}
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

      <Field
        id={idDoCampo('nome')}
        name="nome"
        rotulo={ROTULOS.nome}
        autoComplete="off"
        maxLength={100}
        defaultValue={valores.nome}
        erro={erros.nome}
        key={`n-${valores.nome}`}
      />
      <Field
        id={idDoCampo('telefone')}
        name="telefone"
        tipo="tel"
        rotulo={ROTULOS.telefone}
        autoComplete="off"
        maxLength={30}
        defaultValue={valores.telefone}
        erro={erros.telefone}
        key={`t-${valores.telefone}`}
      />

      <fieldset className={estilos.grupo}>
        <legend>Mensagens da reserva</legend>
        <p className={estilos.ajuda}>
          Marque somente se a cliente concordou com o texto abaixo. Sem o aceite, a reserva é registrada e nenhuma mensagem é enviada.
        </p>
        <Checkbox
          id="reserva-consentimento-mensagens"
          name={CAMPOS_CONSENTIMENTO.mensagensReserva}
          defaultChecked={valores.mensagens}
          key={`m-${valores.mensagens}`}
          rotulo={TEXTOS_CONSENTIMENTO.mensagens_reserva.map((parte, i) =>
            typeof parte === 'string' ? (
              <Fragment key={i}>{parte}</Fragment>
            ) : (
              <a key={i} href={ROTAS[parte.link]} target="_blank" rel="noopener">
                {parte.texto}
                <span className="visualmente-oculto"> (abre em nova aba)</span>
              </a>
            ),
          )}
        />
      </fieldset>

      {pedeConfirmacao ? (
        <Checkbox
          id="reserva-confirmar-encaixe"
          name="confirmarEncaixe"
          rotulo={MENSAGENS_RESERVA_EQUIPE.confirmarEncaixe}
          defaultChecked={valores.confirmarEncaixe}
          key={`c-${valores.confirmarEncaixe}`}
        />
      ) : null}

      <div className={estilos.acoes}>
        <Button type="submit" ocupado={pendente} rotuloOcupado="Registrando…">
          Registrar reserva
        </Button>
      </div>
    </form>
  );
}
