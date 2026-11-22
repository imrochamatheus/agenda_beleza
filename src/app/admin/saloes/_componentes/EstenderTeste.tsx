'use client';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { DIAS_MAX, DIAS_MIN, MENSAGEM_DE_RECUSA } from '@/server/admin/saloes-tipos';
import type { MotivoRecusaExtensao } from '@/server/admin/saloes-tipos';

import { dataEHora, idDoCampo } from '../estado';
import type { EstadoExtensao } from '../estado';
import { SecaoDoSalao } from './SecaoDoSalao';
import estilos from './Saloes.module.css';

export type EstenderTesteProps = {
  salaoId: string;
  fuso: string;
  /** ISO 8601 do fim do teste (o D atual); null fora do teste. */
  fimEm: string | null;
  /** Calculada no servidor com a mesma regra da ação; null = pode estender. */
  recusa: MotivoRecusaExtensao | null;
  estado: EstadoExtensao;
  enviar: (formData: FormData) => void;
  pendente: boolean;
  hrefVoltar: string;
};

/**
 * Teste gratuito (D-044 RN-7; web-design §5.2). Duas etapas por POST: a etapa 1 recebe os dias e devolve a
 * prévia "D → D+N" na resposta; só a etapa 2 chama o provedor. O D esperado viaja oculto (comparação
 * otimista no servidor). Datas no fuso do salão, com data e hora.
 */
export function EstenderTeste({ salaoId, fuso, fimEm, recusa, estado, enviar, pendente, hrefVoltar }: EstenderTesteProps) {
  const r = estado.resultado;
  const previa = r?.resultado === 'previa' ? r : null;
  const recusado = r?.resultado === 'recusado' ? r.motivo : recusa;
  const erroDias = r?.resultado === 'invalido' ? r.erros.dias : undefined;

  return (
    <SecaoDoSalao id="salao-teste" titulo="Teste gratuito">
      {previa !== null && fimEm !== null ? (
        <section role="group" aria-labelledby="salao-teste-confirmar" className={estilos.formulario}>
          <h3 id="salao-teste-confirmar" className="visualmente-oculto">
            Confirmar a extensão do teste
          </h3>
          <div className={estilos.previa}>
            <p className={estilos.destaque}>
              {dataEHora(previa.de, fuso)} → {dataEHora(previa.para, fuso)}
            </p>
            <p className={estilos.suave}>+{previa.dias} {previa.dias === 1 ? 'dia' : 'dias'} de 24 h</p>
          </div>
          <Alert variante="aviso">Isto altera a próxima cobrança no provedor de pagamento e não pode ser desfeito por aqui.</Alert>
          <form action={enviar} className={estilos.acoes}>
            <input type="hidden" name="salaoId" value={salaoId} />
            <input type="hidden" name="dias" value={previa.dias} />
            <input type="hidden" name="testeFimEmEsperado" value={previa.de} />
            <input type="hidden" name="etapa" value="confirmar" />
            <Button type="submit" ocupado={pendente} rotuloOcupado="Estendendo…">
              Estender teste em {previa.dias} {previa.dias === 1 ? 'dia' : 'dias'}
            </Button>
            <a href={hrefVoltar} className={estilos.link}>
              Voltar
            </a>
          </form>
        </section>
      ) : recusado !== null ? (
        <Alert variante="info">{MENSAGEM_DE_RECUSA[recusado]}</Alert>
      ) : (
        <form action={enviar} className={estilos.formulario} noValidate>
          <input type="hidden" name="salaoId" value={salaoId} />
          <input type="hidden" name="etapa" value="previa" />
          {fimEm !== null ? (
            <p>
              O teste termina em <strong>{dataEHora(fimEm, fuso)}</strong>.
            </p>
          ) : null}
          <Field
            id={idDoCampo('dias')}
            name="dias"
            rotulo={`Dias a acrescentar (${DIAS_MIN} a ${DIAS_MAX})`}
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            defaultValue={estado.valores.dias}
            erro={erroDias}
          />
          <div className={estilos.acoes}>
            <Button type="submit" variante="secundaria" ocupado={pendente} rotuloOcupado="Aguarde…">
              Ver novo fim
            </Button>
          </div>
        </form>
      )}
    </SecaoDoSalao>
  );
}
