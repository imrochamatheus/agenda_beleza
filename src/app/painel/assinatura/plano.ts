import { DIAS_TESTE, PRECO_MENSAL_CENTAVOS } from '@/config/plano';
import { formatarMoeda } from '@/lib/format';

/** Texto do plano (preço e prazo vêm de `src/config/plano.ts`; formatação só por `format.ts`). */
export const resumoDoPlano = (): string =>
  `${formatarMoeda(PRECO_MENSAL_CENTAVOS)} por mês, com ${DIAS_TESTE} dias de teste a partir da autorização no provedor de pagamento.`;
