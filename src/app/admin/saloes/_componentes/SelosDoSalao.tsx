import type { EstadoAssinatura } from '@/domain/assinatura';
import { rotuloDeSituacao } from '@/server/assinatura/rotulos';
import type { FormaSelo, VarianteSelo } from '@/server/admin/rotulos-admin';

import { SeloDeEstado } from '../../_componentes/SeloDeEstado';

// Selos da lista e do detalhe dos salões (D-044 web-design §3/§4) sobre o selo genérico do admin
// (`admin/_componentes/SeloDeEstado`, D-045): a cor nunca é o único sinal; cada estado tem uma forma própria.

const POR_ESTADO: Record<EstadoAssinatura | 'sem_assinatura', { forma: FormaSelo; variante: VarianteSelo }> = {
  ativa: { forma: 'circulo', variante: 'sucesso' },
  em_teste: { forma: 'relogio', variante: 'neutro' },
  pendente: { forma: 'triangulo', variante: 'aviso' },
  em_carencia: { forma: 'triangulo', variante: 'aviso' },
  suspensa: { forma: 'traco', variante: 'neutro' },
  cancelada: { forma: 'traco', variante: 'neutro' },
  encerrada: { forma: 'traco', variante: 'neutro' },
  sem_assinatura: { forma: 'traco', variante: 'neutro' },
};

/** Selo do estado da assinatura (`null` = "Sem assinatura"). */
export function SeloDaAssinatura({ estado }: { estado: EstadoAssinatura | null }) {
  const { forma, variante } = POR_ESTADO[estado ?? 'sem_assinatura'];
  return (
    <SeloDeEstado forma={forma} variante={variante}>
      {rotuloDeSituacao(estado ?? 'sem_assinatura')}
    </SeloDeEstado>
  );
}

/** Selo "Suspenso manualmente" (variante de erro com cadeado). */
export function SeloDeSuspensao() {
  return (
    <SeloDeEstado forma="cadeado" variante="erro">
      Suspenso manualmente
    </SeloDeEstado>
  );
}
