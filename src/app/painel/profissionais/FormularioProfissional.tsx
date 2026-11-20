'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_PROFISSIONAL } from '@/server/profissionais/tipos';
import type { ProfissionalVisao } from '@/server/profissionais/tipos';

import { ESTADO_INICIAL_FORMULARIO } from './estado';
import type { EstadoFormularioProfissional } from './estado';
import estilos from './FormularioProfissional.module.css';

export type FormularioProfissionalProps = {
  modo: 'criar' | 'editar';
  /** Ação de servidor (criarProfissionalAcao/editarProfissionalAcao) ou, nos testes, uma função equivalente. */
  acao: (anterior: EstadoFormularioProfissional, formData: FormData) => Promise<EstadoFormularioProfissional>;
  /** Obrigatório no modo editar: valores iniciais, id oculto e e-mail somente leitura. */
  profissional?: Pick<ProfissionalVisao, 'id' | 'nome' | 'email' | 'emailBloqueado'>;
};

/**
 * Cadastro e edição de profissional (D-013 RN-9, RN-11). Envia por POST como formulário HTML mesmo
 * antes da hidratação. Rótulos associados, erros ligados por aria-describedby (Field) e erro geral
 * em Alert (role="alert"). Com usuário vinculado, o e-mail é só leitura (o servidor também recusa).
 */
export function FormularioProfissional({ modo, acao, profissional }: FormularioProfissionalProps) {
  const inicial: EstadoFormularioProfissional = profissional
    ? { ...ESTADO_INICIAL_FORMULARIO, valores: { nome: profissional.nome, email: profissional.email ?? '' } }
    : ESTADO_INICIAL_FORMULARIO;
  const [estado, enviar, pendente] = useActionState(acao, inicial);
  const emailBloqueado = profissional?.emailBloqueado === true;

  return (
    <form action={enviar} className={estilos.formulario} noValidate>
      {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
      {estado.erros.formulario ? <Alert variante="erro">{estado.erros.formulario}</Alert> : null}
      {profissional ? <input type="hidden" name="id" value={profissional.id} /> : null}
      <Field
        rotulo="Nome"
        name="nome"
        autoComplete="off"
        defaultValue={estado.valores.nome}
        erro={estado.erros.nome}
        maxLength={100}
        obrigatorio
      />
      <Field
        rotulo="E-mail"
        tipo="email"
        name="email"
        autoComplete="off"
        defaultValue={estado.valores.email}
        erro={estado.erros.email}
        maxLength={254}
        readOnly={emailBloqueado}
        ajuda={
          emailBloqueado
            ? MENSAGENS_PROFISSIONAL.emailBloqueado
            : 'Opcional. Usado para o convite de acesso ao painel.'
        }
      />
      <div className={estilos.acoes}>
        <Button type="submit" ocupado={pendente} rotuloOcupado="Salvando…">
          {modo === 'criar' ? 'Cadastrar profissional' : 'Salvar alterações'}
        </Button>
        <a href={ROTAS.profissionais}>Voltar para a lista</a>
      </div>
    </form>
  );
}
