import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

import estilos from './Assinatura.module.css';

type Props = {
  /** O que acontece ao cancelar (texto do estado, com as datas já formatadas). */
  aviso: string;
  /** Dica de UX (estado gravado visto pela tela); o servidor a recusa se ≠ real e nunca escolhe o alvo por ela. */
  estadoVisto: string;
  hrefManter: string;
  formCancelar: (formData: FormData) => void;
  cancelando: boolean;
};

/** Etapa 2 do cancelamento: na própria página, sem dialog; só aqui há POST. */
export function ConfirmarCancelamento({ aviso, estadoVisto, hrefManter, formCancelar, cancelando }: Props) {
  return (
    <section className={estilos.secao} aria-labelledby="assinatura-cancelar">
      <h2 id="assinatura-cancelar" tabIndex={-1} className={estilos.tituloSecao}>
        Cancelar assinatura?
      </h2>
      <Alert variante="aviso">{aviso}</Alert>
      <form action={formCancelar} className={estilos.acoes}>
        <input type="hidden" name="estadoVisto" value={estadoVisto} />
        <Button type="submit" variante="perigo" ocupado={cancelando} rotuloOcupado="Cancelando…">
          Sim, cancelar assinatura
        </Button>
        <a href={hrefManter} className={estilos.manter}>
          Manter assinatura
        </a>
      </form>
    </section>
  );
}
