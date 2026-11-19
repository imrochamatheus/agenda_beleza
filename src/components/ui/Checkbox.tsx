'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

import { classes, descritoPor, idsDoCampo } from './campo';
import estilosCampo from './Field.module.css';
import { AjudaDoCampo, ErroDoCampo, temConteudo, TextoDoRotulo } from './Field';
import estilos from './Checkbox.module.css';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Pode conter links (ex.: consentimento com /termos e /privacidade, E4.3). */
  rotulo: ReactNode;
  ajuda?: ReactNode;
  erro?: string;
  obrigatorio?: boolean;
  textoObrigatorio?: string;
  ref?: Ref<HTMLInputElement>;
};

/** Caixa de seleção nativa; o rótulo inteiro é clicável (D-009 RN-8, RN-9). */
export function Checkbox({
  rotulo,
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
}: CheckboxProps) {
  const gerado = useId();
  const ids = idsDoCampo(id ?? gerado);
  const temAjuda = temConteudo(ajuda);
  const temErro = Boolean(erro);

  return (
    <div className={classes(estilosCampo.campo, className)}>
      <label htmlFor={ids.controle} className={estilos.linha}>
        <input
          {...resto}
          ref={ref}
          id={ids.controle}
          type="checkbox"
          className={estilos.caixa}
          required={obrigatorio || required}
          aria-invalid={temErro ? true : resto['aria-invalid']}
          aria-describedby={descritoPor(ids, temAjuda, temErro, descricaoExtra)}
        />
        <span>
          <TextoDoRotulo rotulo={rotulo} obrigatorio={obrigatorio} textoObrigatorio={textoObrigatorio} />
        </span>
      </label>
      {temAjuda && <AjudaDoCampo id={ids.ajuda}>{ajuda}</AjudaDoCampo>}
      {temErro && <ErroDoCampo id={ids.erro} texto={erro!} />}
    </div>
  );
}
