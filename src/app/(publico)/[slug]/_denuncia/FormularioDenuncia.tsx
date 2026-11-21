'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CAMPOS_DENUNCIA } from '@/config/denuncia';
import { LIMITE_TEXTO_DENUNCIA, MOTIVOS_DENUNCIA, ROTULOS_MOTIVO } from '@/server/denuncias/tipos';
import type { DadosDoWidget } from '@/server/protecao/widget-tipos';

import { WidgetTurnstile } from '../_componentes/WidgetTurnstile';
import { ESTADO_INICIAL_DENUNCIA } from './estado';
import type { AcaoDenunciar } from './estado';
import estilos from './FormularioDenuncia.module.css';

export type FormularioDenunciaProps = {
  acao: AcaoDenunciar;
  slug: string;
  avaliacaoId: string;
  /** Nome de exibição (já público): só rotula o botão de abrir, para leitores de tela. */
  nome: string;
  humano: DadosDoWidget;
};

/**
 * Denúncia de uma avaliação (D-035): `<details>` nativo (abre sem JavaScript) com um formulário que
 * envia por POST. O sucesso redireciona (PRG, mensagem uniforme na página); só validação, verificação
 * humana e limite voltam como estado. Um `useActionState` por formulário.
 */
export function FormularioDenuncia({ acao, slug, avaliacaoId, nome, humano }: FormularioDenunciaProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_DENUNCIA);
  const p = `denuncia-${avaliacaoId}`;
  const { erros, valores } = estado;
  return (
    <details className={estilos.detalhes} open={estado.status !== 'inicial' ? true : undefined}>
      <summary aria-label={`Denunciar avaliação de ${nome}`}>Denunciar avaliação</summary>
      <form action={enviar} className={estilos.form} noValidate>
        <input type="hidden" name={CAMPOS_DENUNCIA.slug} value={slug} />
        <input type="hidden" name={CAMPOS_DENUNCIA.avaliacao} value={avaliacaoId} />
        {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
        <fieldset className={estilos.motivos} aria-describedby={erros.motivo ? `${p}-motivo-erro` : undefined}>
          <legend>Motivo (obrigatório)</legend>
          {MOTIVOS_DENUNCIA.map((m) => (
            <label key={m} className={estilos.motivo}>
              <input type="radio" name={CAMPOS_DENUNCIA.motivo} value={m} defaultChecked={valores.motivo === m} />
              <span>{ROTULOS_MOTIVO[m]}</span>
            </label>
          ))}
        </fieldset>
        {erros.motivo ? (
          <p id={`${p}-motivo-erro`} className={estilos.erro}>
            <strong>Erro:</strong> {erros.motivo}
          </p>
        ) : null}
        <div className={estilos.campo}>
          <label htmlFor={`${p}-texto`}>Detalhes (opcional)</label>
          <textarea
            id={`${p}-texto`}
            name={CAMPOS_DENUNCIA.texto}
            className={estilos.texto}
            rows={3}
            defaultValue={valores.texto}
            aria-invalid={erros.texto ? true : undefined}
            aria-describedby={erros.texto ? `${p}-texto-ajuda ${p}-texto-erro` : `${p}-texto-ajuda`}
          />
          <p id={`${p}-texto-ajuda`} className={estilos.ajuda}>
            Até {LIMITE_TEXTO_DENUNCIA} caracteres. Só a equipe da plataforma lê.
          </p>
          {erros.texto ? (
            <p id={`${p}-texto-erro`} className={estilos.erro}>
              <strong>Erro:</strong> {erros.texto}
            </p>
          ) : null}
        </div>
        <WidgetTurnstile dados={humano} id={`${p}-turnstile`} />
        <div>
          <Button type="submit" ocupado={pendente} rotuloOcupado="Enviando…">
            Enviar denúncia
          </Button>
        </div>
      </form>
    </details>
  );
}
