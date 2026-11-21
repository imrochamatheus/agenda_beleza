import { Fragment } from 'react';

import { Checkbox } from '@/components/ui/Checkbox';
import { ROTAS } from '@/config/navegacao';
import { CAMPOS_CONSENTIMENTO, TEXTOS_CONSENTIMENTO, type Finalidade, type ParteDeTexto } from '@/config/termos';
import type { ErrosConsentimento, ValoresConsentimento } from '@/server/consentimento/tipos';

export type CaixasConsentimentoProps = {
  erros?: ErrosConsentimento;
  /** Estado a reexibir depois de um erro (o convite só vem marcado se estava marcado). */
  valores?: Partial<ValoresConsentimento>;
  idPrefixo?: string;
};

function Texto({ finalidade }: { finalidade: Finalidade }) {
  return (
    <>
      {TEXTOS_CONSENTIMENTO[finalidade].map((parte: ParteDeTexto, i) =>
        typeof parte === 'string' ? (
          <Fragment key={i}>{parte}</Fragment>
        ) : (
          <a key={i} href={ROTAS[parte.link]} target="_blank" rel="noopener">
            {parte.texto}
            <span className="visualmente-oculto"> (abre em nova aba)</span>
          </a>
        ),
      )}
    </>
  );
}

/**
 * As duas caixas do consentimento da reserva (D-023 RN-18), na ordem: obrigatória (mensagens da
 * reserva) e opcional desmarcada (convite de avaliação). Sem estado nem JavaScript: o `required` é
 * conveniência, a recusa é do servidor. O rótulo inteiro é clicável (Checkbox).
 */
export function CaixasConsentimento({ erros, valores, idPrefixo = 'consentimento' }: CaixasConsentimentoProps) {
  return (
    <>
      <Checkbox
        id={`${idPrefixo}-mensagens`}
        name={CAMPOS_CONSENTIMENTO.mensagensReserva}
        rotulo={<Texto finalidade="mensagens_reserva" />}
        obrigatorio
        erro={erros?.mensagensReserva}
        defaultChecked={valores?.mensagensReserva === true}
      />
      <Checkbox
        id={`${idPrefixo}-convite`}
        name={CAMPOS_CONSENTIMENTO.conviteAvaliacao}
        rotulo={<Texto finalidade="convite_avaliacao" />}
        defaultChecked={valores?.conviteAvaliacao === true}
      />
    </>
  );
}
