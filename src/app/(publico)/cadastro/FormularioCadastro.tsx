'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ROTAS } from '@/config/navegacao';

import { ESTADO_INICIAL_CADASTRO } from './estado';
import type { EstadoCadastro } from './estado';
import estilos from './FormularioCadastro.module.css';

export type FormularioCadastroProps = {
  /** Ação de servidor (cadastrarAcao) ou, nos testes, uma função assíncrona equivalente. */
  acao: (anterior: EstadoCadastro, formData: FormData) => Promise<EstadoCadastro>;
};

/**
 * Cadastro do gestor e do salão (D-011 RN-7, RN-20). Envia por POST como formulário HTML mesmo
 * antes da hidratação. Após um erro, nome, e-mail e nome do salão voltam preenchidos e a senha
 * nunca volta. No sucesso, o formulário dá lugar ao aviso "Verifique seu e-mail".
 */
export function FormularioCadastro({ acao }: FormularioCadastroProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_CADASTRO);

  if (estado.status === 'sucesso') {
    return (
      <section className={estilos.sucesso} aria-labelledby="cadastro-sucesso">
        <h2 id="cadastro-sucesso">Verifique seu e-mail</h2>
        <p>
          Enviamos um link de confirmação para <strong className={estilos.email}>{estado.valores.email}</strong>. Ele
          vale por 24 horas e só pode ser usado uma vez.
        </p>
        {estado.avisoEnvio ? <Alert variante="aviso">{estado.avisoEnvio}</Alert> : null}
        <ul className={estilos.links}>
          <li>
            <a href={ROTAS.confirmarEmail}>Reenviar link</a>
          </li>
          <li>
            <a href={ROTAS.entrar}>Ir para o login</a>
          </li>
        </ul>
      </section>
    );
  }

  return (
    <form action={enviar} className={estilos.formulario} noValidate>
      {estado.mensagem ? (
        <Alert variante="erro">
          {estado.mensagem}
          {estado.emailExistente ? (
            <ul className={estilos.links}>
              <li>
                <a href={ROTAS.entrar}>Entrar</a>
              </li>
              <li>
                <a href={ROTAS.confirmarEmail}>Pedir um novo link de confirmação</a>
              </li>
            </ul>
          ) : null}
        </Alert>
      ) : null}
      <Field
        rotulo="Seu nome"
        name="nome"
        autoComplete="name"
        defaultValue={estado.valores.nome}
        erro={estado.erros.nome}
        maxLength={100}
        required
      />
      <Field
        rotulo="E-mail"
        tipo="email"
        name="email"
        autoComplete="email"
        defaultValue={estado.valores.email}
        erro={estado.erros.email}
        maxLength={254}
        required
      />
      <Field
        rotulo="Senha"
        tipo="password"
        name="senha"
        autoComplete="new-password"
        ajuda="Mínimo de 8 caracteres"
        defaultValue=""
        erro={estado.erros.senha}
        minLength={8}
        required
      />
      <Field
        rotulo="Nome do salão"
        name="nomeSalao"
        autoComplete="organization"
        defaultValue={estado.valores.nomeSalao}
        erro={estado.erros.nomeSalao}
        maxLength={80}
        required
      />
      <Button type="submit" ocupado={pendente} rotuloOcupado="Criando conta…">
        Criar conta
      </Button>
      <ul className={estilos.links}>
        <li>
          <a href={ROTAS.entrar}>Já tenho conta</a>
        </li>
      </ul>
    </form>
  );
}
