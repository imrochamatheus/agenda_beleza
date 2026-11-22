'use client';

import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { rotuloDeSituacao } from '@/server/assinatura/rotulos';
import { formatarMoeda } from '@/lib/format';
import type { DetalheSalao, MotivoRecusaExtensao } from '@/server/admin/saloes-tipos';
import type { OpcoesFuso } from '@/server/salao/tipos';

import { alertaDoUltimo, dataEHora, estadoEdicaoInicial, estadoExtensaoInicial, estadoSuspensaoInicial, valoresDoDetalhe } from '../estado';
import type { EstadoEdicao, EstadoExtensao, EstadoSuspensao } from '../estado';
import { EstenderTeste } from './EstenderTeste';
import { FormularioDoSalao } from './FormularioDoSalao';
import { SecaoDoSalao } from './SecaoDoSalao';
import { SuspensaoManual } from './SuspensaoManual';
import estilos from './Saloes.module.css';

export type AcoesDoSalao = {
  editar: (anterior: EstadoEdicao, formData: FormData) => Promise<EstadoEdicao>;
  suspender: (anterior: EstadoSuspensao, formData: FormData) => Promise<EstadoSuspensao>;
  reativar: (anterior: EstadoSuspensao, formData: FormData) => Promise<EstadoSuspensao>;
  estender: (anterior: EstadoExtensao, formData: FormData) => Promise<EstadoExtensao>;
};

export type PainelDoSalaoProps = {
  salao: DetalheSalao;
  fusos: OpcoesFuso;
  /** Ações de servidor (reais ou de demonstração). São passadas como referência; nunca como lambda de servidor. */
  acoes: AcoesDoSalao;
  /** Calculada no servidor (mesma regra da ação); null = o teste pode ser estendido. */
  recusaDaExtensao: MotivoRecusaExtensao | null;
  /** Endereço da própria página (o "Voltar" da etapa 2). */
  hrefVoltar: string;
  /** Link "Ver assinatura", só quando a rota existir (E8.3). */
  hrefAssinatura?: string | null;
};

const PRECO = formatarMoeda(7900);

/**
 * Corpo do detalhe do salão (D-044 web-design §5.2). UM `useActionState` por ação, em ordem fixa (editar,
 * suspender, reativar, estender): sem isso, o estado da resposta de um POST sem JavaScript se perde. O
 * resultado mais recente (maior `em`) aparece no topo, antes dos formulários; erros de campo e as etapas 2
 * ficam nos próprios formulários.
 */
export function PainelDoSalao({ salao, fusos, acoes, recusaDaExtensao, hrefVoltar, hrefAssinatura = null }: PainelDoSalaoProps) {
  const [edicao, enviarEdicao, pendenteEdicao] = useActionState(acoes.editar, estadoEdicaoInicial(valoresDoDetalhe(salao)));
  const [suspender, enviarSuspender, pendenteSuspender] = useActionState(acoes.suspender, estadoSuspensaoInicial());
  const [reativar, enviarReativar, pendenteReativar] = useActionState(acoes.reativar, estadoSuspensaoInicial());
  const [estender, enviarEstender, pendenteEstender] = useActionState(acoes.estender, estadoExtensaoInicial());
  const topo = useRef<HTMLDivElement>(null);
  const alerta = alertaDoUltimo({ edicao, suspender, reativar, estender }, salao.fuso);
  const marca = Math.max(edicao.em, suspender.em, reativar.em, estender.em);

  useEffect(() => {
    if (alerta !== null) topo.current?.focus();
  }, [marca, alerta]);

  const a = salao.assinatura;
  return (
    <div className={estilos.detalhe}>
      {alerta !== null ? (
        <div ref={topo} tabIndex={-1} className={estilos.resultado}>
          <Alert variante={alerta.variante}>{alerta.texto}</Alert>
        </div>
      ) : null}

      <FormularioDoSalao estado={edicao} enviar={enviarEdicao} pendente={pendenteEdicao} detalhe={salao} fusos={fusos} />

      <SecaoDoSalao id="salao-assinatura" titulo="Assinatura">
        <dl className={estilos.dados}>
          <dt>Situação</dt>
          <dd>{rotuloDeSituacao(a?.estado ?? 'sem_assinatura')}</dd>
          {a !== null ? (
            <>
              <dt>Plano</dt>
              <dd>{PRECO}/mês</dd>
            </>
          ) : null}
          {a?.estado === 'em_teste' && a.testeFimEm !== null ? (
            <>
              <dt>Fim do teste</dt>
              <dd>{dataEHora(a.testeFimEm, salao.fuso)}</dd>
            </>
          ) : null}
        </dl>
        {hrefAssinatura !== null ? (
          <p>
            <a href={hrefAssinatura} className={estilos.link}>
              Ver assinatura
            </a>
          </p>
        ) : null}
      </SecaoDoSalao>

      <SuspensaoManual
        salaoId={salao.id}
        nomeDoSalao={salao.nome}
        fuso={salao.fuso}
        suspensoEm={salao.suspensoEm}
        assinaturaSuspensa={a?.estado === 'suspensa'}
        suspender={{ estado: suspender, enviar: enviarSuspender, pendente: pendenteSuspender }}
        reativar={{ estado: reativar, enviar: enviarReativar, pendente: pendenteReativar }}
        hrefVoltar={hrefVoltar}
      />

      <EstenderTeste
        salaoId={salao.id}
        fuso={salao.fuso}
        fimEm={a?.testeFimEm ?? null}
        recusa={recusaDaExtensao}
        estado={estender}
        enviar={enviarEstender}
        pendente={pendenteEstender}
        hrefVoltar={hrefVoltar}
      />
    </div>
  );
}
