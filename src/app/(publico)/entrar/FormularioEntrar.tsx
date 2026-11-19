'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ROTAS } from '@/config/navegacao';

import { ESTADO_INICIAL_ENTRAR } from './estado';
import type { EstadoEntrar } from './estado';
import estilos from './FormularioEntrar.module.css';

export type FormularioEntrarProps = {
  /** Ação de servidor (entrarAcao) ou, nos testes, uma função assíncrona equivalente. */
  acao: (anterior: EstadoEntrar, formData: FormData) => Promise<EstadoEntrar>;
  /** Destino pedido pela URL; a ação o revalida (destinoAposLogin). */
  proximo: string | null;
};

/**
 * Formulário de login (D-010 RN-20). Envia por POST como formulário HTML mesmo antes da hidratação.
 * Após um erro, o e-mail volta preenchido e a senha nunca volta.
 */
export function FormularioEntrar({ acao, proximo }: FormularioEntrarProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_ENTRAR);

  return (
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
  );
}
