'use client';

import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react';

import estilos from './Button.module.css';
import { classes } from './campo';

export type VarianteBotao = 'primaria' | 'secundaria' | 'perigo' | 'discreta';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  /** Padrão 'button': só envia formulário com type="submit" explícito. */
  type?: 'button' | 'submit' | 'reset';
  variante?: VarianteBotao;
  /** Ação em andamento: disabled + aria-busy="true" + rotuloOcupado. */
  ocupado?: boolean;
  rotuloOcupado?: string;
  /**
   * D-10: continua focável (aria-disabled="true") para o consumidor explicar o motivo; o clique e
   * o envio de formulário são bloqueados, e o onClick não é chamado.
   */
  desabilitadoFocavel?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/** Botão nativo com as variantes do tema (D-009 RN-9). Ícone sem texto exige aria-label. */
export function Button({
  type = 'button',
  variante = 'primaria',
  ocupado = false,
  rotuloOcupado = 'Aguarde…',
  desabilitadoFocavel = false,
  disabled,
  className,
  children,
  onClick,
  ref,
  ...resto
}: ButtonProps) {
  function aoClicar(evento: MouseEvent<HTMLButtonElement>) {
    if (desabilitadoFocavel) {
      evento.preventDefault();
      return;
    }
    onClick?.(evento);
  }

  return (
    <button
      {...resto}
      ref={ref}
      type={type}
      className={classes(estilos.botao, estilos[variante], className)}
      disabled={disabled || ocupado}
      aria-disabled={desabilitadoFocavel ? true : resto['aria-disabled']}
      aria-busy={ocupado ? true : resto['aria-busy']}
      onClick={aoClicar}
    >
      {ocupado ? rotuloOcupado : children}
    </button>
  );
}
