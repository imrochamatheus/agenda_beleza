import type { ReactNode } from 'react';

import { Alert } from '@/components/ui/Alert';

import estilos from './Assinatura.module.css';

/** Apresentação comum da página real e da vitrine (D-040): estado atual e, se couber, o formulário "Assinar". */
export function ResumoDaAssinatura({ situacao, detalhe, formulario }: { situacao: string; detalhe?: string; formulario: ReactNode }) {
  return (
    <div className={estilos.pagina}>
      <h1>Assinatura</h1>
      <Alert variante="info" titulo={situacao}>
        {detalhe ?? ''}
      </Alert>
      {formulario}
    </div>
  );
}
