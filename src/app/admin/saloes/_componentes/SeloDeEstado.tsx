import type { EstadoAssinatura } from '@/domain/assinatura';
import { rotuloDeSituacao } from '@/server/assinatura/rotulos';

import estilos from './Saloes.module.css';

// Selos da lista e do detalhe (D-044 web-design §3/§4): ícone SVG decorativo (aria-hidden, currentColor)
// + rótulo em texto. A cor nunca é o único sinal: cada estado tem uma forma própria.

type Forma = 'circulo' | 'relogio' | 'triangulo' | 'traco' | 'cadeado';
type Variante = 'neutro' | 'sucesso' | 'aviso' | 'erro';

const POR_ESTADO: Record<EstadoAssinatura | 'sem_assinatura', { forma: Forma; variante: Variante }> = {
  ativa: { forma: 'circulo', variante: 'sucesso' },
  em_teste: { forma: 'relogio', variante: 'neutro' },
  pendente: { forma: 'triangulo', variante: 'aviso' },
  em_carencia: { forma: 'triangulo', variante: 'aviso' },
  suspensa: { forma: 'traco', variante: 'neutro' },
  cancelada: { forma: 'traco', variante: 'neutro' },
  encerrada: { forma: 'traco', variante: 'neutro' },
  sem_assinatura: { forma: 'traco', variante: 'neutro' },
};

function Icone({ forma }: { forma: Forma }) {
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

/** Selo do estado da assinatura (`null` = "Sem assinatura"). */
export function SeloDeEstado({ estado }: { estado: EstadoAssinatura | null }) {
  const { forma, variante } = POR_ESTADO[estado ?? 'sem_assinatura'];
  const classe = variante === 'neutro' ? estilos.selo : `${estilos.selo} ${estilos[variante]}`;
  return (
    <span className={classe}>
      <Icone forma={forma} />
      {rotuloDeSituacao(estado ?? 'sem_assinatura')}
    </span>
  );
}

/** Selo "Suspenso manualmente" (variante de erro com cadeado). */
export function SeloDeSuspensao() {
  return (
    <span className={`${estilos.selo} ${estilos.erro}`}>
      <Icone forma="cadeado" />
      Suspenso manualmente
    </span>
  );
}
