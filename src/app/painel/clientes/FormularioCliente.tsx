'use client';

import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_CLIENTE } from '@/server/clientes/tipos';
import type { CampoCliente } from '@/server/clientes/tipos';

import estilos from './Clientes.module.css';
import { estadoInicial, idDoCampo } from './estado';
import type { EstadoFormularioCliente, ValoresCliente } from './estado';

export type FormularioClienteProps = {
  /** Ação de servidor (editar ou a de demonstração) ou, nos testes, uma função equivalente. */
  acao: (anterior: EstadoFormularioCliente, formData: FormData) => Promise<EstadoFormularioCliente>;
  id: string;
  valoresIniciais: ValoresCliente;
  /**
   * Endereço fixo do cadastro da cliente que já usa o telefone (a vitrine aponta para o detalhe de
   * demonstração). Padrão: a rota do painel. É texto, não função: o componente é cliente.
   */
  hrefExistente?: string;
};

const ID_RESUMO = 'cliente-resumo-erros';
const ID_SUCESSO = 'cliente-sucesso';
const ORDEM: readonly CampoCliente[] = ['nome', 'telefone'];
const ROTULOS: Record<CampoCliente, string> = { nome: 'Nome', telefone: 'Telefone' };

/**
 * Edição de nome e telefone (D-022 RN-10..RN-13, RN-19, CA-18). O resultado volta no estado (sem PRG):
 * funciona sem JavaScript, preserva os valores digitados, e o resumo de erros (ou o sucesso) recebe o foco.
 */
export function FormularioCliente({ acao, id, valoresIniciais, hrefExistente }: FormularioClienteProps) {
  const [estado, enviar, pendente] = useActionState(acao, estadoInicial(valoresIniciais));
  const resumo = useRef<HTMLDivElement>(null);
  const sucesso = useRef<HTMLDivElement>(null);
  const campos = ORDEM.filter((c) => estado.erros[c]);

  useEffect(() => {
    if (campos.length > 0) resumo.current?.focus();
    else if (estado.sucesso) sucesso.current?.focus();
  }, [estado, campos.length]);

  return (
    <form action={enviar} className={estilos.formulario} noValidate>
      <input type="hidden" name="id" value={id} />
      {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
      {campos.length > 0 ? (
        <div ref={resumo} id={ID_RESUMO} tabIndex={-1} className={estilos.resumoErros} role="alert" aria-labelledby={`${ID_RESUMO}-titulo`}>
          <p id={`${ID_RESUMO}-titulo`} className={estilos.resumoTitulo}>
            {MENSAGENS_CLIENTE.resumoErros}
          </p>
          <ul>
            {campos.map((c) => (
              <li key={c}>
                <a href={`#${idDoCampo(c)}`}>
                  {ROTULOS[c]}: {estado.erros[c]}
                </a>
                {c === 'telefone' && estado.existente ? (
                  <>
                    {' '}
                    <a href={hrefExistente ?? ROTAS.cliente(estado.existente.id)}>Ver cadastro de {estado.existente.nome}</a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {estado.sucesso && campos.length === 0 ? (
        <div ref={sucesso} id={ID_SUCESSO} tabIndex={-1} className={estilos.sucesso}>
          <Alert variante="sucesso">{estado.sucesso}</Alert>
        </div>
      ) : null}
      <Field
        id={idDoCampo('nome')}
        name="nome"
        rotulo={ROTULOS.nome}
        autoComplete="off"
        defaultValue={estado.valores.nome}
        erro={estado.erros.nome}
        key={`nome-${estado.valores.nome}-${estado.sucesso ?? ''}`}
      />
      <Field
        id={idDoCampo('telefone')}
        name="telefone"
        tipo="tel"
        rotulo={ROTULOS.telefone}
        ajuda="Com DDD, por exemplo (11) 98765-4321."
        autoComplete="off"
        defaultValue={estado.valores.telefone}
        erro={estado.erros.telefone}
        key={`telefone-${estado.valores.telefone}-${estado.sucesso ?? ''}`}
      />
      <div className={estilos.acoes}>
        <Button type="submit" ocupado={pendente} rotuloOcupado="Salvando…">
          Salvar alterações
        </Button>
      </div>
    </form>
  );
}
