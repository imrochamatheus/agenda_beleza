'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ROTAS } from '@/config/navegacao';

import { ESTADO_INICIAL_RECUPERAR } from './estado';
import type { EstadoRecuperar } from './estado';
import estilos from './FormularioRecuperar.module.css';

export type FormularioRecuperarProps = {
  /** Ação de servidor (solicitarRecuperacaoAcao) ou, nos testes, uma função assíncrona equivalente. */
  acao: (anterior: EstadoRecuperar, formData: FormData) => Promise<EstadoRecuperar>;
};

/**
 * Pedido do link de redefinição de senha (D-012 RN-7, RN-18). Funciona sem JS (POST de formulário
 * HTML). A resposta é uniforme e não revela se o e-mail existe.
 */
export function FormularioRecuperar({ acao }: FormularioRecuperarProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_RECUPERAR);

  return (
    <form action={enviar} className={estilos.formulario} noValidate>
      {estado.mensagem && estado.variante ? <Alert variante={estado.variante}>{estado.mensagem}</Alert> : null}
      <Field
        rotulo="E-mail"
        tipo="email"
        name="email"
        autoComplete="email"
        defaultValue={estado.email}
        erro={estado.erroEmail ?? undefined}
        maxLength={254}
        required
      />
      <Button type="submit" ocupado={pendente} rotuloOcupado="Enviando…">
        Enviar link
      </Button>
      <ul className={estilos.links}>
        <li>
          <a href={ROTAS.entrar}>Voltar para entrar</a>
        </li>
      </ul>
    </form>
  );
}
