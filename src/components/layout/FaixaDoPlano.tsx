import { Alert } from '@/components/ui/Alert';
import type { AvisoDePlano } from '@/server/assinatura/aviso';

import estilos from './Layout.module.css';

/**
 * Faixa de aviso do plano no painel (D-038 §3.5). Apresentacional: só mostra o texto já decidido.
 * `Alert` dá `role="status"` e o rótulo visível ("Atenção:"/"Informação:"), então a cor não é o único sinal.
 */
export function FaixaDoPlano({ aviso }: { aviso: AvisoDePlano }) {
  return (
    <div className={estilos.faixaPlano} data-testid="faixa-do-plano">
      <Alert variante={aviso.tipo}>{aviso.texto}</Alert>
    </div>
  );
}
