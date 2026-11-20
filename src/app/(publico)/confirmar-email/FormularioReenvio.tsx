'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

import { ESTADO_INICIAL_REENVIO } from './estado';
import type { EstadoReenvio } from './estado';
import estilos from './FormularioReenvio.module.css';

export type ModoReenvio = 'email' | 'email-oculto' | 'token';

export type FormularioReenvioProps = {
  /** Ação de servidor (reenviarConfirmacaoAcao) ou, nos testes, uma função assíncrona equivalente. */
  acao: (anterior: EstadoReenvio, formData: FormData) => Promise<EstadoReenvio>;
  /**
   * 'email': campo visível; 'email-oculto': o e-mail já digitado no login vai em campo oculto;
   * 'token': o token do link expirado vai em campo oculto (POST; nunca numa URL nova).
   */
  modo: ModoReenvio;
  email?: string;
  token?: string;
};

/**
 * Reenvio do link de confirmação (D-011 RN-14, RN-20). Funciona sem JS (POST de formulário HTML).
 * A resposta é uniforme e não revela se o e-mail existe.
 */
export function FormularioReenvio({ acao, modo, email = '', token = '' }: FormularioReenvioProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_REENVIO);
  // Sem campo visível, um erro de validação do e-mail vira alerta geral.
  const erroSemCampo = modo === 'email' ? null : estado.erroEmail;

  return (
    <form action={enviar} className={estilos.formulario} noValidate>
      {estado.mensagem && estado.variante ? <Alert variante={estado.variante}>{estado.mensagem}</Alert> : null}
      {erroSemCampo ? <Alert variante="erro">{erroSemCampo}</Alert> : null}
      {modo === 'email' ? (
        <Field
          rotulo="E-mail"
          tipo="email"
          name="email"
          autoComplete="email"
          defaultValue={estado.email || email}
          erro={estado.erroEmail ?? undefined}
          required
        />
      ) : null}
      {modo === 'email-oculto' ? <input type="hidden" name="email" value={email} /> : null}
      {modo === 'token' ? <input type="hidden" name="token" value={token} /> : null}
      <Button
        type="submit"
        variante={modo === 'email' ? 'primaria' : 'secundaria'}
        ocupado={pendente}
        rotuloOcupado="Enviando…"
      >
        Reenviar link de confirmação
      </Button>
    </form>
  );
}
