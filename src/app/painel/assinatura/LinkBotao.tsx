import type { ReactNode } from 'react';

import botao from '@/components/ui/Button.module.css';
import { classes } from '@/components/ui/campo';

import estilos from './Assinatura.module.css';

type Props = { href: string; variante?: 'secundaria' | 'primaria' | 'discreta'; children: ReactNode };

/**
 * Link com a aparência de `Button` (que não tem `href`): navegação GET, sem JavaScript. Reutiliza as
 * classes de `components/ui/Button.module.css`; nenhuma cor própria.
 */
export function LinkBotao({ href, variante = 'secundaria', children }: Props) {
  return (
    <a href={href} className={classes(botao.botao, botao[variante], estilos.linkBotao)}>
      {children}
    </a>
  );
}
