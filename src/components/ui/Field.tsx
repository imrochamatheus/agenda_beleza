'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

import { classes, descritoPor, idsDoCampo } from './campo';
import estilos from './Field.module.css';

export type TipoCampo = 'text' | 'email' | 'password' | 'tel' | 'number' | 'date';

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> & {
  rotulo: string;
  /** Padrão 'text'. A data usa o seletor nativo (D-4). */
  tipo?: TipoCampo;
  ajuda?: ReactNode;
  erro?: string;
  obrigatorio?: boolean;
  /** Texto acrescentado ao rótulo: "Nome (obrigatório)". */
  textoObrigatorio?: string;
  ref?: Ref<HTMLInputElement>;
};

/** Ícone de erro (decorativo: o texto "Erro:" ao lado é o que é lido). */
function IconeErro() {
  return (
    <svg className={estilos.icone} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4v5M8 11v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Mensagem de erro de campo, com o prefixo visível "Erro:" (não depende só da cor). */
export function ErroDoCampo({ id, texto }: { id: string; texto: string }) {
  return (
    <p id={id} className={estilos.erro}>
      <IconeErro />
      <span>
        <strong>Erro:</strong> {texto}
      </span>
    </p>
  );
}

/** Ajuda de campo (ligada ao controle por aria-describedby). */
export function AjudaDoCampo({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className={estilos.ajuda}>
      {children}
    </div>
  );
}

/** Rótulo com a marcação textual de obrigatório. */
export function TextoDoRotulo({
  rotulo,
  obrigatorio,
  textoObrigatorio,
}: {
  rotulo: ReactNode;
  obrigatorio: boolean;
  textoObrigatorio: string;
}) {
  return (
    <>
      {rotulo}
      {obrigatorio && (
        <>
          {' '}
          <span className={estilos.obrigatorio}>({textoObrigatorio})</span>
        </>
      )}
    </>
  );
}

export const temConteudo = (n: ReactNode) => n !== undefined && n !== null && n !== false && n !== '';

/** Campo de texto com rótulo, ajuda e erro acessíveis (D-009 RN-9). */
export function Field({
  rotulo,
  tipo = 'text',
  ajuda,
  erro,
  obrigatorio = false,
  textoObrigatorio = 'obrigatório',
  id,
  className,
  required,
  ref,
  'aria-describedby': descricaoExtra,
  ...resto
}: FieldProps) {
  const gerado = useId();
  const ids = idsDoCampo(id ?? gerado);
  const temAjuda = temConteudo(ajuda);
  const temErro = Boolean(erro);

  return (
    <div className={classes(estilos.campo, className)}>
      <label htmlFor={ids.controle} className={estilos.rotulo}>
        <TextoDoRotulo rotulo={rotulo} obrigatorio={obrigatorio} textoObrigatorio={textoObrigatorio} />
      </label>
      {temAjuda && <AjudaDoCampo id={ids.ajuda}>{ajuda}</AjudaDoCampo>}
      <input
        {...resto}
        ref={ref}
        id={ids.controle}
        type={tipo}
        className={estilos.controle}
        required={obrigatorio || required}
        aria-invalid={temErro ? true : resto['aria-invalid']}
        aria-describedby={descritoPor(ids, temAjuda, temErro, descricaoExtra)}
      />
      {temErro && <ErroDoCampo id={ids.erro} texto={erro!} />}
    </div>
  );
}
