'use client';

import { useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ErroDoCampo, Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { GRADES_PERMITIDAS, MENSAGENS_CONFIGURACOES } from '@/server/salao/tipos';
import type { OpcaoFuso, OpcoesFuso } from '@/server/salao/tipos';
import { MENSAGENS_ADMIN_SALOES as M } from '@/server/admin/saloes-tipos';
import type { CampoEdicao, DetalheSalao, ErrosEdicao } from '@/server/admin/saloes-tipos';

import { idDoCampo, valoresDoDetalhe } from '../estado';
import type { EstadoEdicao } from '../estado';
import { SecaoDoSalao } from './SecaoDoSalao';
import estilos from './Saloes.module.css';

export type FormularioDoSalaoProps = {
  estado: EstadoEdicao;
  enviar: (formData: FormData) => void;
  pendente: boolean;
  detalhe: DetalheSalao;
  /** Opções prontas (fusos.ts, no servidor). */
  fusos: OpcoesFuso;
};

const ROTULOS: Record<CampoEdicao, string> = {
  nome: 'Nome',
  slug: 'Endereço do salão',
  fuso: 'Fuso horário',
  grade: 'Intervalo da grade (minutos)',
  antecedencia: 'Antecedência mínima (horas)',
  janela: 'Janela de reserva (dias)',
  intervalo: 'Intervalo entre atendimentos (minutos)',
  gestorNome: 'Nome do gestor',
  gestorEmail: 'E-mail do gestor',
};

const ORDEM: readonly CampoEdicao[] = ['nome', 'slug', 'fuso', 'grade', 'antecedencia', 'janela', 'intervalo', 'gestorNome', 'gestorEmail'];
const ID_RESUMO = 'salao-resumo-erros';
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
 * Dados do salão, regras da agenda e gestor (D-044 RN-4, RN-5; web-design §5.2): UM formulário e UM botão,
 * para não haver estado parcial. O resultado volta no estado (sem PRG): funciona sem JavaScript, preserva os
 * valores digitados em caso de erro e mostra o resumo de erros (focado com JavaScript).
 */
export function FormularioDoSalao({ estado, enviar, pendente, detalhe, fusos }: FormularioDoSalaoProps) {
  const resumo = useRef<HTMLDivElement>(null);
  const r = estado.resultado;
  const erros: ErrosEdicao = r !== null && 'erros' in r ? r.erros : {};
  const comErro = ORDEM.filter((c) => erros[c]);
  const valores = comErro.length > 0 ? estado.valores : valoresDoDetalhe(detalhe);

  useEffect(() => {
    if (comErro.length > 0) resumo.current?.focus();
  }, [estado, comErro.length]);

  // Remonta os campos quando os valores gravados mudam ou quando o servidor devolve erros.
  const chave = `${estado.em}-${Object.values(valores).join('|')}`;
  const descricaoFuso = [`${idDoCampo('fuso')}-ajuda`, erros.fuso ? `${idDoCampo('fuso')}-erro` : ''].filter(Boolean).join(' ');
  const gestor = detalhe.gestor;

  return (
    <form action={enviar} className={estilos.formulario} noValidate key={chave}>
      <input type="hidden" name="salaoId" value={detalhe.id} />
      {comErro.length > 0 ? (
        <div ref={resumo} id={ID_RESUMO} tabIndex={-1} className={estilos.resumoErros} role="alert" aria-labelledby={`${ID_RESUMO}-titulo`}>
          <p id={`${ID_RESUMO}-titulo`} className={estilos.resumoTitulo}>
            {M.resumoErros}
          </p>
          <ul>
            {comErro.map((c) => (
              <li key={c}>
                <a href={`#${idDoCampo(c)}`}>
                  {ROTULOS[c]}: {erros[c]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <SecaoDoSalao id="salao-dados" titulo="Dados do salão">
        <Field id={idDoCampo('nome')} name="nome" rotulo={ROTULOS.nome} maxLength={80} autoComplete="off" defaultValue={valores.nome} erro={erros.nome} />
        <Field
          id={idDoCampo('slug')}
          name="slug"
          rotulo={ROTULOS.slug}
          ajuda="O endereço anterior continua levando a este salão."
          maxLength={200}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={valores.slug}
          erro={erros.slug}
        />
        <div className={estilos.campo}>
          <label htmlFor={idDoCampo('fuso')} className={estilos.rotulo}>
            {ROTULOS.fuso}
          </label>
          <p id={`${idDoCampo('fuso')}-ajuda`} className={estilos.ajuda}>
            {MENSAGENS_CONFIGURACOES.ajudaFuso}
          </p>
          <select
            id={idDoCampo('fuso')}
            name="fuso"
            className={estilos.select}
            defaultValue={valores.fuso}
            aria-describedby={descricaoFuso}
            aria-invalid={erros.fuso ? true : undefined}
          >
            {fusos.atualForaDaLista ? <option value={fusos.atualForaDaLista.valor}>{fusos.atualForaDaLista.rotulo}</option> : null}
            <optgroup label="Brasil">
              <Opcoes lista={fusos.brasil} />
            </optgroup>
            <optgroup label="Outros">
              <Opcoes lista={fusos.outros} />
            </optgroup>
          </select>
          {erros.fuso ? <ErroDoCampo id={`${idDoCampo('fuso')}-erro`} texto={erros.fuso} /> : null}
        </div>
      </SecaoDoSalao>

      <SecaoDoSalao id="salao-regras" titulo="Regras da agenda">
        <p className={estilos.ajuda}>{MENSAGENS_CONFIGURACOES.ajudaRegras}</p>
        <Select id={idDoCampo('grade')} name="grade" rotulo={ROTULOS.grade} opcoes={OPCOES_GRADE} defaultValue={valores.grade} erro={erros.grade} />
        <Field {...NUMERICO} id={idDoCampo('antecedencia')} name="antecedencia" rotulo={ROTULOS.antecedencia} defaultValue={valores.antecedencia} erro={erros.antecedencia} />
        <Field {...NUMERICO} id={idDoCampo('janela')} name="janela" rotulo={ROTULOS.janela} defaultValue={valores.janela} erro={erros.janela} />
        <Field {...NUMERICO} id={idDoCampo('intervalo')} name="intervalo" rotulo={ROTULOS.intervalo} defaultValue={valores.intervalo} erro={erros.intervalo} />
      </SecaoDoSalao>

      {gestor !== null ? (
        <SecaoDoSalao id="salao-gestor" titulo="Gestor">
          <Alert variante="aviso">
            Trocar o e-mail desfaz a confirmação, encerra as sessões do gestor e envia um link de confirmação ao novo endereço. A senha não é alterada.
          </Alert>
          <Field id={idDoCampo('gestorNome')} name="gestorNome" rotulo={ROTULOS.gestorNome} maxLength={100} autoComplete="off" defaultValue={valores.gestorNome} erro={erros.gestorNome} />
          <Field
            id={idDoCampo('gestorEmail')}
            name="gestorEmail"
            tipo="email"
            rotulo={ROTULOS.gestorEmail}
            maxLength={254}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={valores.gestorEmail}
            erro={erros.gestorEmail}
          />
        </SecaoDoSalao>
      ) : null}

      <div className={estilos.acoes}>
        <Button type="submit" ocupado={pendente} rotuloOcupado="Salvando…">
          Salvar alterações
        </Button>
      </div>
    </form>
  );
}
