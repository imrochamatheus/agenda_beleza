'use client';

import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ErroDoCampo, Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';
import type { CampoBloqueio, OpcaoAlvo, ValoresBloqueio } from '@/server/bloqueios/tipos';

import { AvisoReservasCobertas } from './AvisoReservasCobertas';
import estilos from './Bloqueios.module.css';
import { estadoInicial, idDoCampo } from './estado';
import type { EstadoFormularioBloqueio } from './estado';

export type FormularioBloqueioProps = {
  /** Ação de servidor (criar/editar ou a de demonstração) ou, nos testes, uma função equivalente. */
  acao: (anterior: EstadoFormularioBloqueio, formData: FormData) => Promise<EstadoFormularioBloqueio>;
  /** Gestor: opções do alvo; null = profissional (o bloqueio vale para a própria agenda). */
  opcoesAlvo: OpcaoAlvo[] | null;
  /** Edição: id do bloqueio (campo oculto); o alvo não muda (RN-11) e aparece como texto. */
  id?: string;
  alvoTexto?: string;
  valoresIniciais?: ValoresBloqueio;
  rotuloEnviar: string;
};

const ID_AJUDA = 'bloqueio-ajuda';
const ID_RESUMO = 'bloqueio-resumo-erros';
const ID_SALVO = 'bloqueio-salvo';
const ID_ERRO_PERIODO = `${idDoCampo('periodo')}-erro`;
const ID_ERRO_MODO = `${idDoCampo('modo')}-erro`;

/** Ordem do resumo (a da página) e o campo para onde cada erro leva. */
const ORDEM: readonly (Exclude<CampoBloqueio, 'formulario'>)[] = [
  'alvo',
  'modo',
  'dataInicio',
  'horaInicio',
  'dataFim',
  'horaFim',
  'periodo',
  'motivo',
];
const DESTINO: Partial<Record<CampoBloqueio, CampoBloqueio>> = { periodo: 'dataInicio' };

const ROTULOS: Record<Exclude<CampoBloqueio, 'formulario'>, string> = {
  alvo: 'Para quem',
  modo: 'Tipo de bloqueio',
  dataInicio: 'Data de início',
  horaInicio: 'Hora de início',
  dataFim: 'Data de fim',
  horaFim: 'Hora de fim',
  periodo: 'Período',
  motivo: 'Motivo',
};

const COMUNS_DATA = { autoComplete: 'off', maxLength: 10, inputMode: 'numeric', pattern: '\\d{2}/\\d{2}/\\d{4}' } as const;
const COMUNS_HORA = { autoComplete: 'off', maxLength: 5, inputMode: 'numeric', pattern: '([01]?[0-9]|2[0-3]):[0-5][0-9]' } as const;

/**
 * Formulário de criação e de edição de bloqueio (D-016 §3.7; RN-1..RN-7, RN-15, RN-19). Um único
 * conjunto de campos de texto (datas dd/mm/aaaa e horas HH:MM) e um rádio de modo; no "Dia inteiro" as
 * horas são ignoradas pelo servidor (D-17). Funciona sem JavaScript (useActionState). Com erros, um
 * resumo no topo com links para os campos, focado ao chegar; depois de salvar, a seção com o período e
 * o aviso de reservas cobertas recebe o foco (CA-21). Na criação, os campos voltam vazios após salvar.
 */
export function FormularioBloqueio({ acao, opcoesAlvo, id, alvoTexto, valoresIniciais, rotuloEnviar }: FormularioBloqueioProps) {
  const [estado, enviar, pendente] = useActionState(acao, estadoInicial(valoresIniciais));
  const resumo = useRef<HTMLDivElement>(null);
  const secaoSalvo = useRef<HTMLElement>(null);
  const { erros, valores, salvo } = estado;
  const itens = ORDEM.filter((campo) => erros[campo]).map((campo) => ({
    href: `#${idDoCampo(DESTINO[campo] ?? campo)}`,
    texto: `${ROTULOS[campo]}: ${erros[campo]}`,
  }));
  const temErros = itens.length > 0;
  const erroPeriodo = erros.periodo;
  const descricaoPeriodo = [ID_AJUDA, erroPeriodo ? ID_ERRO_PERIODO : ''].filter(Boolean).join(' ');

  useEffect(() => {
    if (temErros) resumo.current?.focus();
    else if (salvo) secaoSalvo.current?.focus();
  }, [estado, temErros, salvo]);

  const campoPeriodo = {
    'aria-describedby': descricaoPeriodo,
    'aria-invalid': erroPeriodo ? true : undefined,
  } as const;

  return (
    <form action={enviar} className={estilos.formulario} noValidate>
      {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
      {erros.formulario ? <Alert variante="erro">{erros.formulario}</Alert> : null}
      {temErros ? (
        <div ref={resumo} id={ID_RESUMO} tabIndex={-1} className={estilos.resumoErros} role="alert" aria-labelledby={`${ID_RESUMO}-titulo`}>
          <p id={`${ID_RESUMO}-titulo`} className={estilos.resumoTitulo}>
            {MENSAGENS_BLOQUEIO.resumoErros}
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
      {salvo && !temErros ? (
        <section ref={secaoSalvo} id={ID_SALVO} tabIndex={-1} className={estilos.salvo} aria-labelledby={`${ID_SALVO}-titulo`}>
          <h2 id={`${ID_SALVO}-titulo`} className={estilos.salvoTitulo}>
            {MENSAGENS_BLOQUEIO.salvo}
          </h2>
          <Alert variante="sucesso">Bloqueio salvo: {salvo.periodo}.</Alert>
          <AvisoReservasCobertas aviso={salvo.aviso} />
        </section>
      ) : null}

      {id !== undefined ? (
        <>
          <input type="hidden" name="id" value={id} />
          {alvoTexto ? (
            <p className={estilos.alvoFixo}>
              <strong>Para quem:</strong> {alvoTexto}
            </p>
          ) : null}
        </>
      ) : opcoesAlvo !== null ? (
        <Select
          id={idDoCampo('alvo')}
          name="alvo"
          rotulo={ROTULOS.alvo}
          textoVazio="Escolha…"
          opcoes={opcoesAlvo}
          defaultValue={valores.alvo}
          erro={erros.alvo}
          key={`alvo-${valores.alvo}`}
        />
      ) : (
        <p className={estilos.alvoFixo}>{MENSAGENS_BLOQUEIO.propriaAgenda}</p>
      )}

      <fieldset className={estilos.periodo} aria-describedby={descricaoPeriodo}>
        <legend>Período</legend>
        <p id={ID_AJUDA} className={estilos.ajuda}>
          {MENSAGENS_BLOQUEIO.ajudaPeriodo}
        </p>
        <fieldset className={estilos.modos} aria-describedby={erros.modo ? ID_ERRO_MODO : undefined}>
          <legend>{ROTULOS.modo}</legend>
          <div className={estilos.opcoesModo} key={`modo-${valores.modo}`}>
            <label className={estilos.radio}>
              <input
                type="radio"
                id={idDoCampo('modo')}
                name="modo"
                value="horario"
                defaultChecked={valores.modo !== 'dia_inteiro'}
              />
              Com horário
            </label>
            <label className={estilos.radio}>
              <input
                type="radio"
                id={`${idDoCampo('modo')}-dia-inteiro`}
                name="modo"
                value="dia_inteiro"
                defaultChecked={valores.modo === 'dia_inteiro'}
              />
              Dia inteiro
            </label>
          </div>
          {erros.modo ? <ErroDoCampo id={ID_ERRO_MODO} texto={erros.modo} /> : null}
        </fieldset>
        <div className={estilos.campos}>
          <Field
            {...COMUNS_DATA}
            {...campoPeriodo}
            id={idDoCampo('dataInicio')}
            name="dataInicio"
            rotulo={ROTULOS.dataInicio}
            defaultValue={valores.dataInicio}
            erro={erros.dataInicio}
            key={`di-${valores.dataInicio}`}
          />
          <Field
            {...COMUNS_HORA}
            {...campoPeriodo}
            id={idDoCampo('horaInicio')}
            name="horaInicio"
            rotulo={ROTULOS.horaInicio}
            defaultValue={valores.horaInicio}
            erro={erros.horaInicio}
            key={`hi-${valores.horaInicio}`}
          />
          <Field
            {...COMUNS_DATA}
            {...campoPeriodo}
            id={idDoCampo('dataFim')}
            name="dataFim"
            rotulo={ROTULOS.dataFim}
            defaultValue={valores.dataFim}
            erro={erros.dataFim}
            key={`df-${valores.dataFim}`}
          />
          <Field
            {...COMUNS_HORA}
            {...campoPeriodo}
            id={idDoCampo('horaFim')}
            name="horaFim"
            rotulo={ROTULOS.horaFim}
            defaultValue={valores.horaFim}
            erro={erros.horaFim}
            key={`hf-${valores.horaFim}`}
          />
        </div>
        {erroPeriodo ? <ErroDoCampo id={ID_ERRO_PERIODO} texto={erroPeriodo} /> : null}
      </fieldset>

      <Field
        id={idDoCampo('motivo')}
        name="motivo"
        rotulo={`${ROTULOS.motivo} (opcional)`}
        maxLength={200}
        autoComplete="off"
        defaultValue={valores.motivo}
        erro={erros.motivo}
        key={`mo-${valores.motivo}`}
      />

      <div className={estilos.acoes}>
        <Button type="submit" ocupado={pendente} rotuloOcupado="Salvando…">
          {rotuloEnviar}
        </Button>
      </div>
    </form>
  );
}
