'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

import { ESTADO_INICIAL_ADMIN } from './estado';
import type { EstadoAdmin } from './estado';
import estilos from './FormularioAdmin.module.css';

export type FormularioAdminProps = {
  /** Ação de servidor ou, na vitrine e nos testes, uma função assíncrona equivalente. */
  acao: (anterior: EstadoAdmin, formData: FormData) => Promise<EstadoAdmin>;
  /** 'credenciais' = e-mail e senha; 'codigo' = código de 6 dígitos do autenticador. */
  campos: 'credenciais' | 'codigo';
  rotuloBotao: string;
  rotuloOcupado: string;
};

/** Formulário do login do super admin. Envia por POST como formulário HTML mesmo sem JavaScript. */
export function FormularioAdmin({ acao, campos, rotuloBotao, rotuloOcupado }: FormularioAdminProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_ADMIN);
  return (
    <form action={enviar} className={estilos.formulario} noValidate>
      {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
      {estado.aviso ? <Alert variante="info">{estado.aviso}</Alert> : null}
      {campos === 'credenciais' ? (
        <>
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
        </>
      ) : (
        <Field
          rotulo="Código de 6 dígitos"
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          defaultValue=""
          erro={estado.erros.codigo}
          required
        />
      )}
      <Button type="submit" ocupado={pendente} rotuloOcupado={rotuloOcupado}>
        {rotuloBotao}
      </Button>
    </form>
  );
}
