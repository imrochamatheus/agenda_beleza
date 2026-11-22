'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ROTAS } from '@/config/navegacao';

import { ESTADO_INICIAL_CONVITE } from './estado';
import type { EstadoConvite } from './estado';
import estilos from './FormularioConvite.module.css';

export type FormularioConviteProps = {
  /** Ação de servidor (aceitarConviteAcao) ou, nos testes, uma função assíncrona equivalente. */
  acao: (anterior: EstadoConvite, formData: FormData) => Promise<EstadoConvite>;
  /** Token do link (vai só no campo oculto; nunca em texto visível). */
  token: string;
  /** Veredito da página no GET (o link só é verificado, não consumido). */
  verificacao: 'valido' | 'recusado';
  /** Mensagem única de recusa. */
  mensagemRecusa: string;
};

/**
 * /convite/[token] (D-039). Um único componente decide entre formulário, recusa e sucesso. O estado da
 * ação PREVALECE sobre o veredito da página: no POST sem JS a página é renderizada de novo e veria o
 * convite já usado, mas o estado da ação traz o sucesso. Funciona sem JS. A senha nunca volta preenchida.
 */
export function FormularioConvite({ acao, token, verificacao, mensagemRecusa }: FormularioConviteProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_CONVITE);
  const visao = estado.status === 'inicial' ? (verificacao === 'valido' ? 'formulario' : 'recusado') : estado.status;

  if (visao === 'sucesso') {
    return (
      <section className={estilos.bloco}>
        <h1>Senha definida</h1>
        <Alert variante="sucesso">{estado.mensagem}</Alert>
        <ul className={estilos.links}>
          <li>
            <a href={ROTAS.entrar}>Entrar</a>
          </li>
        </ul>
      </section>
    );
  }

  if (visao === 'recusado') {
    return (
      <section className={estilos.bloco}>
        <h1>Convite inválido</h1>
        <Alert variante="erro">{estado.mensagem ?? mensagemRecusa}</Alert>
      </section>
    );
  }

  return (
    <section className={estilos.bloco}>
      <h1>Ativar o seu acesso</h1>
      <p>Defina uma senha para entrar no painel do salão.</p>
      <form action={enviar} className={estilos.bloco} noValidate>
        {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
        <input type="hidden" name="token" value={token} />
        <Field
          rotulo="Senha"
          tipo="password"
          name="senha"
          autoComplete="new-password"
          ajuda="Mínimo de 8 caracteres"
          defaultValue=""
          erro={estado.erroSenha ?? undefined}
          minLength={8}
          required
        />
        <Button type="submit" ocupado={pendente} rotuloOcupado="Salvando…">
          Definir senha
        </Button>
      </form>
    </section>
  );
}
