'use client';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { MOTIVO_MAX } from '@/server/admin/saloes-tipos';

import { dataEHora, idDoCampo } from '../estado';
import type { EstadoSuspensao } from '../estado';
import { SecaoDoSalao } from './SecaoDoSalao';
import estilos from './Saloes.module.css';

export type SuspensaoManualProps = {
  salaoId: string;
  nomeDoSalao: string;
  fuso: string;
  /** ISO 8601 do `suspenso_manual_em`; null = ativo. */
  suspensoEm: string | null;
  /** A assinatura está `suspensa` (reativar NÃO a reativa). */
  assinaturaSuspensa: boolean;
  suspender: { estado: EstadoSuspensao; enviar: (formData: FormData) => void; pendente: boolean };
  reativar: { estado: EstadoSuspensao; enviar: (formData: FormData) => void; pendente: boolean };
  /** Endereço da própria página (o "Voltar" da etapa 2 recarrega o detalhe). */
  hrefVoltar: string;
};

/**
 * Suspensão manual (D-044 RN-6; web-design §5.2). Suspender tem DUAS etapas por POST (o motivo digitado nunca
 * vai na URL): a etapa 1 pede o motivo e devolve a etapa 2 na própria resposta, com o motivo em campos
 * ocultos; só a etapa 2 grava. Reativar é uma etapa só (reversível sem custo).
 */
export function SuspensaoManual({ salaoId, nomeDoSalao, fuso, suspensoEm, assinaturaSuspensa, suspender, reativar, hrefVoltar }: SuspensaoManualProps) {
  const previa = suspender.estado.resultado?.resultado === 'previa' ? suspender.estado.resultado : null;
  const erroSusp = suspender.estado.resultado?.resultado === 'invalido' ? suspender.estado.resultado.erros.motivo : undefined;
  const erroReat = reativar.estado.resultado?.resultado === 'invalido' ? reativar.estado.resultado.erros.motivo : undefined;

  return (
    <SecaoDoSalao id="salao-suspensao" titulo="Suspensão">
      {suspensoEm !== null ? (
        <form action={reativar.enviar} className={estilos.formulario} noValidate>
          <input type="hidden" name="salaoId" value={salaoId} />
          <p>Suspenso manualmente em {dataEHora(suspensoEm, fuso)}.</p>
          {assinaturaSuspensa ? <Alert variante="info">Reativar o salão não reativa a assinatura.</Alert> : null}
          <Field
            id={idDoCampo('motivo')}
            name="motivo"
            rotulo="Motivo (opcional)"
            ajuda="Não escreva telefone, e-mail ou dados de clientes. O motivo fica só na auditoria."
            maxLength={MOTIVO_MAX}
            autoComplete="off"
            defaultValue={reativar.estado.valores.motivo}
            erro={erroReat}
          />
          <div className={estilos.acoes}>
            <Button type="submit" variante="primaria" ocupado={reativar.pendente} rotuloOcupado="Reativando…">
              Reativar salão
            </Button>
          </div>
        </form>
      ) : previa !== null ? (
        <section role="group" aria-labelledby="salao-suspensao-confirmar" className={estilos.formulario}>
          <h3 id="salao-suspensao-confirmar" className="visualmente-oculto">
            Confirmar a suspensão
          </h3>
          <Alert variante="aviso">Suspender {nomeDoSalao}? Ela deixa de aceitar novas reservas agora.</Alert>
          <blockquote className={estilos.citacao}>{previa.motivo}</blockquote>
          <form action={suspender.enviar} className={estilos.acoes}>
            <input type="hidden" name="salaoId" value={salaoId} />
            <input type="hidden" name="motivo" value={previa.motivo} />
            <input type="hidden" name="etapa" value="confirmar" />
            <Button type="submit" variante="perigo" ocupado={suspender.pendente} rotuloOcupado="Suspendendo…">
              Suspender salão
            </Button>
            <a href={hrefVoltar} className={estilos.link}>
              Voltar
            </a>
          </form>
        </section>
      ) : (
        <form action={suspender.enviar} className={estilos.formulario} noValidate>
          <input type="hidden" name="salaoId" value={salaoId} />
          <input type="hidden" name="etapa" value="previa" />
          <p>
            Enquanto suspenso, o salão não recebe novas reservas. A assinatura e as sessões não são alteradas. Cancelamentos de reservas futuras continuam
            permitidos.
          </p>
          <Field
            id={idDoCampo('motivo')}
            name="motivo"
            rotulo="Motivo"
            obrigatorio
            ajuda="Não escreva telefone, e-mail ou dados de clientes. O motivo fica só na auditoria."
            maxLength={MOTIVO_MAX}
            autoComplete="off"
            defaultValue={suspender.estado.valores.motivo}
            erro={erroSusp}
          />
          <div className={estilos.acoes}>
            <Button type="submit" variante="secundaria" ocupado={suspender.pendente} rotuloOcupado="Aguarde…">
              Continuar
            </Button>
          </div>
        </form>
      )}
    </SecaoDoSalao>
  );
}
