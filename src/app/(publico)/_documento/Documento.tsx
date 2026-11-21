import { Alert } from '@/components/ui/Alert';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { AVISO_PROVISORIO, type Documento as DocumentoDados } from '@/config/termos-documentos';
import { VERSAO_TERMOS, VIGENCIA_TERMOS } from '@/config/termos';
import { formatarDataCivil } from '@/lib/format';

import estilos from './Documento.module.css';

/** Corpo comum de /termos e /privacidade (D-023 RN-16): estático, sem sessão nem banco. */
export function Documento({ documento }: { documento: DocumentoDados }) {
  return (
    <PublicLayout>
      <article className={estilos.documento}>
        <h1>{documento.titulo}</h1>
        <p className={estilos.meta}>
          Versão {VERSAO_TERMOS} · Vigência a partir de {formatarDataCivil(VIGENCIA_TERMOS)}
        </p>
        <Alert variante="aviso" titulo="Texto provisório">
          {AVISO_PROVISORIO}
        </Alert>
        <nav aria-label="Índice do documento" className={estilos.indice}>
          <ul>
            {documento.secoes.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.titulo}</a>
              </li>
            ))}
          </ul>
        </nav>
        {documento.secoes.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-titulo`} className={estilos.secao}>
            <h2 id={`${s.id}-titulo`}>{s.titulo}</h2>
            {s.paragrafos.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>
        ))}
      </article>
    </PublicLayout>
  );
}
