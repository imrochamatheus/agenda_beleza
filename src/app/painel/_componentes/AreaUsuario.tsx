import { Button } from '@/components/ui/Button';

import { sairAcao } from '../acoes';
import estilos from './Painel.module.css';

/** Nome do usuário e "Sair" (D-010 RN-21, D-14): formulário POST, funciona sem JavaScript. */
export function AreaUsuario({ nome }: { nome: string }) {
  return (
    <form action={sairAcao} className={estilos.areaUsuario}>
      <span className={estilos.nomeUsuario}>{nome}</span>
      <Button type="submit" variante="discreta">
        Sair
      </Button>
    </form>
  );
}
