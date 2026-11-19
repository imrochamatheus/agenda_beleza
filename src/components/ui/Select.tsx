'use client';

import { useId, type ReactNode, type Ref, type SelectHTMLAttributes } from 'react';

import { classes, descritoPor, idsDoCampo } from './campo';
import { AjudaDoCampo, ErroDoCampo, temConteudo, TextoDoRotulo } from './Field';
import estilos from './Field.module.css';
import proprios from './Select.module.css';

export type Opcao = { valor: string; rotulo: string; desabilitada?: boolean };

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  rotulo: string;
  opcoes: readonly Opcao[];
  /** Quando informado, vira a 1ª opção, com value="". */
  textoVazio?: string;
  ajuda?: ReactNode;
  erro?: string;
  obrigatorio?: boolean;
  textoObrigatorio?: string;
  ref?: Ref<HTMLSelectElement>;
};

/** Select nativo com as mesmas regras de rótulo, ajuda e erro do Field (D-009 RN-9). */
export function Select({
  rotulo,
  opcoes,
  textoVazio,
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
}: SelectProps) {
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
      <select
        {...resto}
        ref={ref}
        id={ids.controle}
        className={classes(estilos.controle, proprios.select)}
        required={obrigatorio || required}
        aria-invalid={temErro ? true : resto['aria-invalid']}
        aria-describedby={descritoPor(ids, temAjuda, temErro, descricaoExtra)}
      >
        {textoVazio !== undefined && <option value="">{textoVazio}</option>}
        {opcoes.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor} disabled={opcao.desabilitada}>
            {opcao.rotulo}
          </option>
        ))}
      </select>
      {temErro && <ErroDoCampo id={ids.erro} texto={erro!} />}
    </div>
  );
}
