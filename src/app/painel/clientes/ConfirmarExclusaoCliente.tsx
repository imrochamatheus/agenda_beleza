'use client';

import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/Button';
import { TEXTO_CONFIRMACAO_EXCLUSAO } from '@/server/clientes/tipos';

import estilos from './Clientes.module.css';

export type ConfirmarExclusaoClienteProps = {
  /** Ação de servidor (ou a de demonstração): recebe o FormData com `clienteId` e termina em redirect. */
  acao: (formData: FormData) => Promise<void>;
  clienteId: string;
  nome: string;
  /** Texto (não função): endereço de volta, sem alterar nada. */
  hrefCancelar: string;
};

/**
 * Segunda etapa da exclusão (D-031 RN-11): diz o que acontece, que é irreversível, e só executa pelo
 * botão "Confirmar exclusão". Funciona sem JavaScript (form POST de Server Action; "Cancelar" é um link).
 * Com JavaScript, o foco inicial vai ao título para o leitor de tela anunciar a página.
 */
export function ConfirmarExclusaoCliente({ acao, clienteId, nome, hrefCancelar }: ConfirmarExclusaoClienteProps) {
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titulo.current?.focus();
  }, []);

  return (
    <section className={estilos.secao} aria-labelledby="exclusao-titulo">
      <h1 ref={titulo} id="exclusao-titulo" tabIndex={-1} className={estilos.tituloFoco}>
        {TEXTO_CONFIRMACAO_EXCLUSAO.titulo}
      </h1>
      <p>
        Cliente: <strong>{nome}</strong>
      </p>
      <ul className={estilos.consequencias}>
        {TEXTO_CONFIRMACAO_EXCLUSAO.oQueAcontece.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <form action={acao} className={estilos.acoes}>
        <input type="hidden" name="clienteId" value={clienteId} />
        <Button type="submit" variante="perigo">
          {TEXTO_CONFIRMACAO_EXCLUSAO.confirmar}
        </Button>
        <a href={hrefCancelar} className={estilos.link}>
          {TEXTO_CONFIRMACAO_EXCLUSAO.cancelar}
        </a>
      </form>
    </section>
  );
}
