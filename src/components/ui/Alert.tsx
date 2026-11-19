import type { ReactNode } from 'react';

import estilos from './Alert.module.css';
import { classes } from './campo';

export type VarianteAlerta = 'info' | 'sucesso' | 'aviso' | 'erro';

const ROTULOS: Record<VarianteAlerta, string> = {
  info: 'Informação',
  sucesso: 'Sucesso',
  aviso: 'Atenção',
  erro: 'Erro',
};

export type AlertProps = {
  variante: VarianteAlerta;
  titulo?: string;
  children: ReactNode;
  /** Sobrescreve o rótulo visível da variante ("Atenção:"). */
  rotulosVariante?: Partial<Record<VarianteAlerta, string>>;
};

/**
 * Alerta (D-009 RN-18): erro usa role="alert"; as demais variantes, role="status". A variante
 * também aparece em texto visível no início (não só pela cor).
 */
export function Alert({ variante, titulo, children, rotulosVariante }: AlertProps) {
  const rotulo = rotulosVariante?.[variante] ?? ROTULOS[variante];
  return (
    <div role={variante === 'erro' ? 'alert' : 'status'} className={classes(estilos.alerta, estilos[variante])}>
      <p className={estilos.cabeca}>
        <strong className={estilos.rotulo}>{rotulo}:</strong>
        {titulo ? <span className={estilos.titulo}> {titulo}</span> : null}
      </p>
      <div className={estilos.texto}>{children}</div>
    </div>
  );
}
