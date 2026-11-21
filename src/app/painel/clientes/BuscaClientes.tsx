import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { LIMITES_CLIENTE } from '@/server/clientes/tipos';

import estilos from './Clientes.module.css';

export type BuscaClientesProps = {
  /** Endereço da lista (a busca é um GET que funciona sem JavaScript). */
  base: string;
  q: string;
};

/** Busca por nome ou telefone (D-022 RN-9, RN-19): `<form method="get">`, rótulo e botão "Buscar". */
export function BuscaClientes({ base, q }: BuscaClientesProps) {
  return (
    <form method="get" action={base} role="search" className={estilos.busca}>
      <Field
        id="clientes-busca"
        name="q"
        rotulo="Buscar por nome ou telefone"
        ajuda="Acentos e maiúsculas não importam. Para telefone, digite ao menos 3 números."
        defaultValue={q}
        maxLength={LIMITES_CLIENTE.buscaMax}
        autoComplete="off"
        key={q}
      />
      <div className={estilos.acoes}>
        <Button type="submit">Buscar</Button>
        {q !== '' ? (
          <a href={base} className={estilos.link}>
            Limpar busca
          </a>
        ) : null}
      </div>
    </form>
  );
}
