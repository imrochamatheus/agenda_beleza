'use client';

import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ErroDoCampo, Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { GRADES_PERMITIDAS, MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';
import type { CampoRegras, OpcaoFuso, OpcoesFuso, ValoresRegras } from '@/server/salao/tipos';

import estilos from './Configuracoes.module.css';
import { estadoRegrasInicial, idDoCampo } from './estado';
import type { EstadoRegras } from './estado';

export type FormularioRegrasProps = {
  /** Ação de servidor (real ou de demonstração) ou, nos testes, uma função equivalente. */
  acao: (anterior: EstadoRegras, formData: FormData) => Promise<EstadoRegras>;
  valoresIniciais: ValoresRegras;
  /** Opções prontas (fusos.ts, no servidor). */
  fusos: OpcoesFuso;
};

export const ROTULOS_REGRAS: Record<CampoRegras, string> = {
  nome: 'Nome do salão',
  fuso: 'Fuso horário',
  grade: 'Grade de horários (minutos)',
  antecedencia: 'Antecedência mínima (horas)',
  janela: 'Janela máxima (dias)',
  intervalo: 'Intervalo entre atendimentos (minutos)',
};

const ORDEM: readonly CampoRegras[] = ['nome', 'fuso', 'grade', 'antecedencia', 'janela', 'intervalo'];
const ID_RESUMO = 'config-regras-resumo';
const ID_SUCESSO = 'config-regras-sucesso';
const ID_AJUDA_REGRAS = 'config-regras-ajuda';
const ID_FUSO = idDoCampo('fuso');
const OPCOES_GRADE = GRADES_PERMITIDAS.map((g) => ({ valor: String(g), rotulo: `${g} minutos` }));
const NUMERICO = { inputMode: 'numeric', maxLength: 4, pattern: '[0-9]*', autoComplete: 'off' } as const;

function Opcoes({ lista }: { lista: readonly OpcaoFuso[] }) {
  return lista.map((o) => (
    <option key={o.valor} value={o.valor}>
      {o.rotulo}
    </option>
  ));
}

/**
 * "Dados e regras de horário" (D-017 RN-9..RN-11, RN-19). Funciona sem JavaScript (useActionState). Com
 * erros, resumo no topo com links para os campos, focado ao chegar; com sucesso, a mensagem é focada.
 * O fuso é um <select> nativo com o grupo "Brasil" primeiro (e o valor gravado fora da lista, se houver).
 */
export function FormularioRegras({ acao, valoresIniciais, fusos }: FormularioRegrasProps) {
  const [estado, enviar, pendente] = useActionState(acao, estadoRegrasInicial(valoresIniciais));
  const resumo = useRef<HTMLDivElement>(null);
  const sucesso = useRef<HTMLDivElement>(null);
  const { erros, valores } = estado;
  const itens = ORDEM.filter((campo) => erros[campo]).map((campo) => ({
    href: `#${idDoCampo(campo)}`,
    texto: `${ROTULOS_REGRAS[campo]}: ${erros[campo]}`,
  }));
  const temErros = itens.length > 0;

  useEffect(() => {
    if (temErros) resumo.current?.focus();
    else if (estado.sucesso) sucesso.current?.focus();
  }, [estado, temErros]);

  const descricaoFuso = [`${ID_FUSO}-ajuda`, erros.fuso ? `${ID_FUSO}-erro` : ''].filter(Boolean).join(' ');

  return (
    <form action={enviar} className={estilos.formulario} noValidate>
      {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
      {temErros ? (
        <div ref={resumo} id={ID_RESUMO} tabIndex={-1} className={estilos.resumoErros} role="alert" aria-labelledby={`${ID_RESUMO}-titulo`}>
          <p id={`${ID_RESUMO}-titulo`} className={estilos.resumoTitulo}>
            {M.resumoErros}
          </p>
          <ul>
            {itens.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.texto}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {estado.sucesso && !temErros ? (
        <div ref={sucesso} id={ID_SUCESSO} tabIndex={-1} className={estilos.sucesso}>
          <Alert variante="sucesso">{estado.sucesso}</Alert>
        </div>
      ) : null}

      <Field
        id={idDoCampo('nome')}
        name="nome"
        rotulo={ROTULOS_REGRAS.nome}
        maxLength={80}
        autoComplete="organization"
        defaultValue={valores.nome}
        erro={erros.nome}
        key={`nome-${valores.nome}`}
      />

      <div className={estilos.campo}>
        <label htmlFor={ID_FUSO} className={estilos.rotulo}>
          {ROTULOS_REGRAS.fuso}
        </label>
        <p id={`${ID_FUSO}-ajuda`} className={estilos.ajuda}>
          {M.ajudaFuso}
        </p>
        <select
          id={ID_FUSO}
          name="fuso"
          className={estilos.select}
          defaultValue={valores.fuso}
          aria-describedby={descricaoFuso}
          aria-invalid={erros.fuso ? true : undefined}
          key={`fuso-${valores.fuso}`}
        >
          {fusos.atualForaDaLista ? (
            <option value={fusos.atualForaDaLista.valor}>{fusos.atualForaDaLista.rotulo}</option>
          ) : null}
          <optgroup label="Brasil">
            <Opcoes lista={fusos.brasil} />
          </optgroup>
          <optgroup label="Outros">
            <Opcoes lista={fusos.outros} />
          </optgroup>
        </select>
        {erros.fuso ? <ErroDoCampo id={`${ID_FUSO}-erro`} texto={erros.fuso} /> : null}
      </div>

      <fieldset className={estilos.grupo} aria-describedby={ID_AJUDA_REGRAS}>
        <legend>Regras de horário</legend>
        <p id={ID_AJUDA_REGRAS} className={estilos.ajuda}>
          {M.ajudaRegras}
        </p>
        <Select
          id={idDoCampo('grade')}
          name="grade"
          rotulo={ROTULOS_REGRAS.grade}
          opcoes={OPCOES_GRADE}
          defaultValue={valores.grade}
          erro={erros.grade}
          key={`grade-${valores.grade}`}
        />
        <Field
          {...NUMERICO}
          id={idDoCampo('antecedencia')}
          name="antecedencia"
          rotulo={ROTULOS_REGRAS.antecedencia}
          defaultValue={valores.antecedencia}
          erro={erros.antecedencia}
          key={`antecedencia-${valores.antecedencia}`}
        />
        <Field
          {...NUMERICO}
          id={idDoCampo('janela')}
          name="janela"
          rotulo={ROTULOS_REGRAS.janela}
          defaultValue={valores.janela}
          erro={erros.janela}
          key={`janela-${valores.janela}`}
        />
        <Field
          {...NUMERICO}
          id={idDoCampo('intervalo')}
          name="intervalo"
          rotulo={ROTULOS_REGRAS.intervalo}
          defaultValue={valores.intervalo}
          erro={erros.intervalo}
          key={`intervalo-${valores.intervalo}`}
        />
      </fieldset>

      <div className={estilos.acoes}>
        <Button type="submit" ocupado={pendente} rotuloOcupado="Salvando…">
          Salvar configurações
        </Button>
      </div>
    </form>
  );
}
