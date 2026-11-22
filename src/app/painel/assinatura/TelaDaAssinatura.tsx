'use client';

import { useActionState } from 'react';
import type { ReactNode } from 'react';

import { Alert } from '@/components/ui/Alert';
import type { AcaoPrimaria } from '@/server/assinatura/tela-tipos';

import { AcoesDaAssinatura } from './AcoesDaAssinatura';
import estilos from './Assinatura.module.css';
import { ConfirmarCancelamento } from './ConfirmarCancelamento';
import { ESTADO_ACAO_INICIAL } from './estado';
import type { AcoesDaTela, EstadoAcaoAssinatura } from './estado';

type Props = {
  acoes: AcoesDaTela;
  primaria: AcaoPrimaria | null;
  podeCancelar: boolean;
  /** `?cancelar=1` e o estado permite cancelar (a página ignora o parâmetro caso contrário). */
  confirmando: boolean;
  avisoDoCancelamento: string | null;
  estadoVisto: string;
  hrefCancelar: string;
  hrefManter: string;
  /** Slots de componentes servidores (texto e datas já formatados no servidor). */
  situacao: ReactNode;
  historico: ReactNode;
  /** Só a vitrine: resultado já presente na primeira renderização (a página real nunca o informa). */
  resultadoInicial?: EstadoAcaoAssinatura;
};

/**
 * Parte interativa da tela (D-042 §3.5): TRÊS `useActionState` em ordem fixa (assinar, regularizar,
 * cancelar), para o estado da resposta do POST sem JavaScript não se perder quando a ação muda após a
 * releitura. O resultado fica no `Alert` acima do bloco de estado; a releitura vem da renderização do servidor.
 */
export function TelaDaAssinatura(p: Props) {
  const [assinar, enviarAssinar, assinando] = useActionState(p.acoes.assinar, ESTADO_ACAO_INICIAL);
  const [regularizar, enviarRegularizar, regularizando] = useActionState(p.acoes.regularizar, ESTADO_ACAO_INICIAL);
  const [cancelar, enviarCancelar, cancelando] = useActionState(p.acoes.cancelar, p.resultadoInicial ?? ESTADO_ACAO_INICIAL);
  const resultado = [assinar, regularizar, cancelar].filter((e) => e.mensagem !== null).sort((a, b) => b.em - a.em)[0];
  const confirmando = p.confirmando && p.podeCancelar && p.avisoDoCancelamento !== null;
  return (
    <div className={estilos.tela}>
      {resultado ? (
        <Alert variante={resultado.variante} rotulosVariante={{ erro: 'Erro de pagamento' }}>
          {resultado.mensagem}
        </Alert>
      ) : null}
      {p.situacao}
      <AcoesDaAssinatura
        primaria={p.primaria}
        mostrarCancelar={p.podeCancelar && !confirmando}
        hrefCancelar={p.hrefCancelar}
        formAssinar={enviarAssinar}
        formRegularizar={enviarRegularizar}
        assinando={assinando}
        regularizando={regularizando}
      />
      {confirmando && p.avisoDoCancelamento !== null ? (
        <ConfirmarCancelamento
          aviso={p.avisoDoCancelamento}
          estadoVisto={p.estadoVisto}
          hrefManter={p.hrefManter}
          formCancelar={enviarCancelar}
          cancelando={cancelando}
        />
      ) : null}
      {p.historico}
    </div>
  );
}
