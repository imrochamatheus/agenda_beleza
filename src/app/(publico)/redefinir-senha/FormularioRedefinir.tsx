'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ROTAS } from '@/config/navegacao';

import { ESTADO_INICIAL_REDEFINIR } from './estado';
import type { EstadoRedefinir } from './estado';
import estilos from './FormularioRedefinir.module.css';

export type FormularioRedefinirProps = {
  /** Ação de servidor (redefinirSenhaAcao) ou, nos testes, uma função assíncrona equivalente. */
  acao: (anterior: EstadoRedefinir, formData: FormData) => Promise<EstadoRedefinir>;
  /** Token do link (vai só no campo oculto; nunca em texto visível nem em URL nova). */
  token: string;
  /** Veredito da página no GET (o link só é verificado, não consumido). */
  verificacao: 'valido' | 'recusado';
  /** Mensagem única de recusa (RN-10). */
  mensagemRecusa: string;
};

/**
 * /redefinir-senha (D-012 RN-10, RN-11, RN-18, D-18). Um único componente decide entre formulário,
 * recusa e sucesso. O estado da ação PREVALECE sobre o veredito da página: no POST sem JS a página
 * é renderizada de novo e veria o token já usado, mas o estado da ação traz o sucesso. Funciona sem
 * JS (POST de formulário HTML). A senha nunca volta preenchida.
 */
export function FormularioRedefinir({ acao, token, verificacao, mensagemRecusa }: FormularioRedefinirProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_REDEFINIR);
  const visao = estado.status === 'inicial' ? (verificacao === 'valido' ? 'formulario' : 'recusado') : estado.status;

  if (visao === 'sucesso') {
    return (
      <section className={estilos.bloco}>
        <h1>Senha alterada</h1>
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
        <h1>Link inválido</h1>
        <Alert variante="erro">{estado.mensagem ?? mensagemRecusa}</Alert>
        <ul className={estilos.links}>
          <li>
            <a href={ROTAS.recuperarSenha}>Pedir um novo link</a>
          </li>
        </ul>
      </section>
    );
  }

  return (
    <section className={estilos.bloco}>
      <h1>Definir nova senha</h1>
      <form action={enviar} className={estilos.bloco} noValidate>
        {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
        <input type="hidden" name="token" value={token} />
        <Field
          rotulo="Nova senha"
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
          Salvar nova senha
        </Button>
      </form>
    </section>
  );
}
