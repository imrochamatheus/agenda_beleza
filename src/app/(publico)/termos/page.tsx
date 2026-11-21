import type { Metadata } from 'next';

import { DOCUMENTOS } from '@/config/termos-documentos';

import { Documento } from '../_documento/Documento';

export const dynamic = 'force-static';
export const metadata: Metadata = { title: 'Termos de Uso' };

/** /termos (D-023 RN-16): conteúdo estático de src/config/termos-documentos.ts. */
export default function PaginaTermos() {
  return <Documento documento={DOCUMENTOS.termos} />;
}
