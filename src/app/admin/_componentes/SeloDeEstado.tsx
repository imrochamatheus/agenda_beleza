import type { ReactNode } from 'react';

import type { FormaSelo, VarianteSelo } from '@/server/admin/rotulos-admin';

import estilos from './Admin.module.css';

// Selo do painel do admin (D-045 web-design §4.1; generaliza o selo da D-044): ícone SVG decorativo
// (aria-hidden, currentColor) + rótulo em texto dentro de um <span>. A cor nunca é o único sinal: cada
// forma é própria. Em 48rem ou mais o selo NUNCA quebra linha (corrige a quebra "Pagamento não / confirmado");
// abaixo, a célula empilha e o texto pode quebrar dentro de `max-width: 100%`.

export function IconeDeSelo({ forma }: { forma: FormaSelo }) {
  const comum = { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: false } as const;
  switch (forma) {
    case 'circulo':
      return (
        <svg {...comum}>
          <circle cx="8" cy="8" r="6" fill="currentColor" />
        </svg>
      );
    case 'relogio':
      return (
        <svg {...comum}>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'triangulo':
      return (
        <svg {...comum}>
          <path d="M8 2 15 14H1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M8 6.5v3.5M8 11.8v.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'cadeado':
      return (
        <svg {...comum}>
          <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    default:
      return (
        <svg {...comum}>
          <path d="M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

export function SeloDeEstado({ forma, variante, children }: { forma: FormaSelo; variante: VarianteSelo; children: ReactNode }) {
  const classe = variante === 'neutro' ? estilos.selo : `${estilos.selo} ${estilos[variante]}`;
  return (
    <span className={classe}>
      <IconeDeSelo forma={forma} />
      <span>{children}</span>
    </span>
  );
}
