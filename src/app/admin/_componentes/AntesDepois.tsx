import type { ReactNode } from 'react';

import estilos from './Admin.module.css';

// Antes/depois da auditoria e payload do webhook (D-045 web-design §4.4). Tudo texto escapado pelo React; nada
// é interpretado como HTML. Diff por campo com "Antes"/"Depois" em texto (sem depender de cor); o JSON
// completo fica recolhido num <details> aninhado, em <pre> com rolagem interna e quebra de linha.

export const MAX_CAMPOS_MOSTRADOS = 30;
/** Valor mais longo que isso é cortado no diff; o JSON completo continua recolhido logo abaixo. */
export const MAX_VALOR = 300;

type Valor = unknown;

const igual = (a: Valor, b: Valor): boolean => JSON.stringify(a) === JSON.stringify(b);

function Escalar({ v }: { v: Valor }): ReactNode {
  if (v === null || v === undefined) return '(vazio)';
  const texto = typeof v === 'object' ? JSON.stringify(v) : String(v);
  const curto = texto.length > MAX_VALOR ? `${texto.slice(0, MAX_VALOR)}… (veja o JSON completo)` : texto;
  return typeof v === 'object' ? <code>{curto}</code> : curto;
}

function jsonCompleto(v: Valor): string {
  return JSON.stringify(v, null, 2) ?? '';
}

function JsonRecolhido({ valor }: { valor: Valor }) {
  return (
    <details>
      <summary>Ver JSON completo</summary>
      <pre className={estilos.json} tabIndex={0}>
        {jsonCompleto(valor)}
      </pre>
    </details>
  );
}

const ehObjeto = (v: Valor): v is Record<string, Valor> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Auditoria: `<details>` "Ver alterações (N campos)" com diff por campo; ambos nulos → "Sem detalhes". */
export function AntesDepois({ antes, depois }: { antes: Record<string, Valor> | null; depois: Record<string, Valor> | null }) {
  if (antes === null && depois === null) return <span className={estilos.suave}>Sem detalhes</span>;
  const a = antes ?? {};
  const d = depois ?? {};
  const chaves = [...Object.keys(a), ...Object.keys(d).filter((k) => !Object.hasOwn(a, k))];
  const mostrar = chaves.slice(0, MAX_CAMPOS_MOSTRADOS);
  return (
    <details className={estilos.detalhes}>
      <summary>
        Ver alterações ({chaves.length} {chaves.length === 1 ? 'campo' : 'campos'})
      </summary>
      <dl className={estilos.campos}>
        {mostrar.map((k) => {
          const temA = Object.hasOwn(a, k);
          const temD = Object.hasOwn(d, k);
          return (
            <div key={k} className={estilos.campo}>
              <dt>{k}</dt>
              {temA && temD && igual(a[k], d[k]) ? (
                <dd className={estilos.semMudanca}>
                  <span className={estilos.rotuloLado}>Sem mudança:</span> <Escalar v={a[k]} />
                </dd>
              ) : (
                <>
                  {temA ? (
                    <dd>
                      <span className={estilos.rotuloLado}>Antes:</span> <Escalar v={a[k]} />
                    </dd>
                  ) : null}
                  {temD ? (
                    <dd>
                      <span className={estilos.rotuloLado}>Depois:</span> <Escalar v={d[k]} />
                    </dd>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </dl>
      {chaves.length > MAX_CAMPOS_MOSTRADOS ? (
        <p className={estilos.suave}>
          e mais {chaves.length - MAX_CAMPOS_MOSTRADOS} campos (veja o JSON completo)
        </p>
      ) : null}
      <JsonRecolhido valor={{ antes, depois }} />
    </details>
  );
}

/** Webhook: payload já sanitizado, como gravado, em campos (um lado só) + JSON completo recolhido. */
export function JsonLegivel({ valor, rotulo = 'Ver payload' }: { valor: Valor; rotulo?: string }) {
  const campos = ehObjeto(valor) ? Object.keys(valor) : [];
  return (
    <details className={estilos.detalhes}>
      <summary>{rotulo}</summary>
      {campos.length > 0 && ehObjeto(valor) ? (
        <>
          <dl className={estilos.campos}>
            {campos.slice(0, MAX_CAMPOS_MOSTRADOS).map((k) => (
              <div key={k} className={estilos.campo}>
                <dt>{k}</dt>
                <dd>
                  <Escalar v={valor[k]} />
                </dd>
              </div>
            ))}
          </dl>
          {campos.length > MAX_CAMPOS_MOSTRADOS ? (
            <p className={estilos.suave}>e mais {campos.length - MAX_CAMPOS_MOSTRADOS} campos (veja o JSON completo)</p>
          ) : null}
        </>
      ) : null}
      <JsonRecolhido valor={valor} />
    </details>
  );
}
