'use client';

import { useActionState, useEffect, useRef } from 'react';

import { CamposDaSemana } from '@/app/painel/_componentes/semana/CamposDaSemana';
import { itensDoResumo } from '@/app/painel/_componentes/semana/formulario';
import { ResumoDeErros } from '@/app/painel/_componentes/semana/ResumoDeErros';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ErroDoCampo } from '@/components/ui/Field';
import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_FUNCIONAMENTO as M } from '@/server/salao/funcionamento-tipos';
import type { Funcionamento } from '@/server/salao/funcionamento-tipos';

import { estadoFuncionamentoInicial, ID_MODO, PREFIXO_FUNCIONAMENTO, SEMANA_VAZIA } from './estado';
import type { EstadoFuncionamento } from './estado';
import estilos from './Funcionamento.module.css';

export type FormularioFuncionamentoProps = {
  /** Ação de servidor (real ou de demonstração) ou, nos testes, uma função equivalente. */
  acao: (anterior: EstadoFuncionamento, formData: FormData) => Promise<EstadoFuncionamento>;
  /** Funcionamento gravado: estado inicial e resumo de cada dia. */
  funcionamento: Funcionamento;
};

const ID_AJUDA = 'funcionamento-ajuda';
const ID_RESUMO = 'funcionamento-resumo-erros';
const ID_SUCESSO = 'funcionamento-sucesso';
const ID_AJUDA_MODO = 'funcionamento-modo-ajuda';

/**
 * Horário de funcionamento do salão (D-020 §3.8; RN-11..RN-14, RN-19). Um único formulário HTML
 * (funciona sem JavaScript): a escolha "Não informar"/"Informar" por botões de opção e a semana no
 * editor compartilhado (segunda → domingo, 6 linhas por dia, "Fechado" no dia vazio). As linhas ficam
 * sempre visíveis e habilitadas. Com erros, resumo focado; com sucesso, a mensagem é focada e os campos
 * renascem com a semana canônica (`key` do formulário, A-9).
 */
export function FormularioFuncionamento({ acao, funcionamento }: FormularioFuncionamentoProps) {
  const [estado, enviar, pendente] = useActionState(acao, estadoFuncionamentoInicial(funcionamento));
  const resumo = useRef<HTMLDivElement>(null);
  const sucesso = useRef<HTMLDivElement>(null);
  const { erros } = estado;
  const itens = [
    ...(erros.modo ? [{ href: `#${ID_MODO}`, texto: `Horário de funcionamento: ${erros.modo}` }] : []),
    ...itensDoResumo(PREFIXO_FUNCIONAMENTO, erros),
  ];
  const temErros = itens.length > 0;
  const gravado = estado.funcionamento ?? funcionamento;
  const semana = gravado.definido ? gravado.semana : SEMANA_VAZIA;

  useEffect(() => {
    if (temErros) resumo.current?.focus();
    else if (estado.sucesso) sucesso.current?.focus();
  }, [estado, temErros]);

  const descricaoModo = [ID_AJUDA_MODO, erros.modo ? `${ID_MODO}-erro` : ''].filter(Boolean).join(' ');
  const comunsModo = {
    name: 'modo',
    type: 'radio',
    className: estilos.radio,
    'aria-describedby': descricaoModo,
    'aria-invalid': erros.modo ? true : undefined,
  } as const;

  return (
    <form action={enviar} className={estilos.formulario} noValidate key={JSON.stringify([estado.modo, estado.valores])}>
      {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
      {erros.formulario ? <Alert variante="erro">{erros.formulario}</Alert> : null}
      {temErros ? <ResumoDeErros ref={resumo} id={ID_RESUMO} titulo={M.resumoErros} itens={itens} /> : null}
      {estado.sucesso && !temErros ? (
        <div ref={sucesso} id={ID_SUCESSO} tabIndex={-1} className={estilos.sucesso}>
          <Alert variante="sucesso">{estado.sucesso}</Alert>
        </div>
      ) : null}

      <fieldset className={estilos.grupo}>
        <legend>Horário de funcionamento</legend>
        {erros.modo ? <ErroDoCampo id={`${ID_MODO}-erro`} texto={erros.modo} /> : null}
        <label className={estilos.opcao} htmlFor={ID_MODO}>
          <input {...comunsModo} id={ID_MODO} value="nao_informar" defaultChecked={estado.modo === 'nao_informar'} />
          <span>{M.opcaoNaoInformar}</span>
        </label>
        <label className={estilos.opcao} htmlFor={`${ID_MODO}-informar`}>
          <input {...comunsModo} id={`${ID_MODO}-informar`} value="informar" defaultChecked={estado.modo === 'informar'} />
          <span>{M.opcaoInformar}</span>
        </label>
        <p id={ID_AJUDA_MODO} className={estilos.ajuda}>
          {M.ajudaNaoInformar}
        </p>
      </fieldset>

      <p id={ID_AJUDA} className={estilos.ajuda}>
        {M.ajudaHorario}
      </p>
      <p className={estilos.ajuda}>
        {M.ajudaFeriados} <a href={ROTAS.bloqueios}>Ir para bloqueios</a>
      </p>
      <CamposDaSemana
        prefixoId={PREFIXO_FUNCIONAMENTO}
        idAjuda={ID_AJUDA}
        semana={semana}
        valores={estado.valores}
        erros={erros}
        textoDiaVazio={gravado.definido ? M.fechado : M.diaNaoInformado}
      />
      <div className={estilos.acoes}>
        <Button type="submit" ocupado={pendente} rotuloOcupado="Salvando…">
          Salvar horário
        </Button>
      </div>
    </form>
  );
}
