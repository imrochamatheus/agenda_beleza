'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ROTAS } from '@/config/navegacao';

import type { EstadoReenvio } from '../confirmar-email/estado';
import { FormularioReenvio } from '../confirmar-email/FormularioReenvio';

import { ESTADO_INICIAL_ENTRAR } from './estado';
import type { EstadoEntrar } from './estado';
import estilos from './FormularioEntrar.module.css';

export type FormularioEntrarProps = {
  /** Ação de servidor (entrarAcao) ou, nos testes, uma função assíncrona equivalente. */
  acao: (anterior: EstadoEntrar, formData: FormData) => Promise<EstadoEntrar>;
  /** Destino pedido pela URL; a ação o revalida (destinoAposLogin). */
  proximo: string | null;
  /** Ação de reenvio do link de confirmação (D-011 RN-16), usada só no caso "e-mail não confirmado". */
  acaoReenvio: (anterior: EstadoReenvio, formData: FormData) => Promise<EstadoReenvio>;
};

/**
 * Formulário de login (D-010 RN-20). Envia por POST como formulário HTML mesmo antes da hidratação.
 * Após um erro, o e-mail volta preenchido e a senha nunca volta.
 */
export function FormularioEntrar({ acao, proximo, acaoReenvio }: FormularioEntrarProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_ENTRAR);

  return (
    <>
      <form action={enviar} className={estilos.formulario} noValidate>
        {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
        {proximo ? <input type="hidden" name="proximo" value={proximo} /> : null}
        <Field
          rotulo="E-mail"
          tipo="email"
          name="email"
          autoComplete="username"
          defaultValue={estado.email}
          erro={estado.erros.email}
          required
        />
        <Field
          rotulo="Senha"
          tipo="password"
          name="senha"
          autoComplete="current-password"
          defaultValue=""
          erro={estado.erros.senha}
          required
        />
        <Button type="submit" ocupado={pendente} rotuloOcupado="Entrando…">
          Entrar
        </Button>
        <ul className={estilos.links}>
          <li>
            <a href={ROTAS.recuperarSenha}>Esqueci minha senha</a>
          </li>
          <li>
            <a href={ROTAS.cadastro}>Criar conta do salão</a>
          </li>
        </ul>
      </form>
      {/* Formulário irmão (nunca aninhado): só aparece depois de provar a senha (D-011 RN-16). */}
      {estado.reenvioDisponivel ? (
        <div className={estilos.reenvio}>
          <FormularioReenvio key={estado.email} acao={acaoReenvio} modo="email-oculto" email={estado.email} />
        </div>
      ) : null}
    </>
  );
}
