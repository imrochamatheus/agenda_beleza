import type { Metadata } from 'next';

import { DOCUMENTOS } from '@/config/termos-documentos';

import { Documento } from '../_documento/Documento';

export const dynamic = 'force-static';
export const metadata: Metadata = { title: 'Política de Privacidade' };

/** /privacidade (D-023 RN-16, RN-17): inclui a seção #avaliacoes. */
export default function PaginaPrivacidade() {
  return <Documento documento={DOCUMENTOS.privacidade} />;
}
