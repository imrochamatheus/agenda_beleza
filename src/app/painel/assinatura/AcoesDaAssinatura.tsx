import { Button } from '@/components/ui/Button';
import type { AcaoPrimaria } from '@/server/assinatura/tela-tipos';

import estilos from './Assinatura.module.css';
import { LinkBotao } from './LinkBotao';
import { ROTULOS_DAS_ACOES } from './textos';

type Props = {
  primaria: AcaoPrimaria | null;
  /** Mostra "Cancelar assinatura" (etapa 1); some quando a etapa 2 já está aberta. */
  mostrarCancelar: boolean;
  hrefCancelar: string;
  formAssinar: (formData: FormData) => void;
  formRegularizar: (formData: FormData) => void;
  assinando: boolean;
  regularizando: boolean;
};

/** Ações do estado: uma primária (formulário POST) e o link GET "Cancelar assinatura" (etapa 1, sem POST). */
export function AcoesDaAssinatura({ primaria, mostrarCancelar, hrefCancelar, formAssinar, formRegularizar, assinando, regularizando }: Props) {
  if (primaria === null && !mostrarCancelar) return null;
  const ehRegularizar = primaria === 'regularizar' || primaria === 'atualizar';
  return (
    <div className={estilos.acoes}>
      {primaria === null ? null : (
        <form action={ehRegularizar ? formRegularizar : formAssinar} className={estilos.formAcao}>
          <Button
            type="submit"
            variante="primaria"
            ocupado={ehRegularizar ? regularizando : assinando}
            rotuloOcupado={ROTULOS_DAS_ACOES[primaria].ocupado}
          >
            {ROTULOS_DAS_ACOES[primaria].texto}
          </Button>
        </form>
      )}
      {mostrarCancelar ? <LinkBotao href={hrefCancelar}>Cancelar assinatura</LinkBotao> : null}
    </div>
  );
}
