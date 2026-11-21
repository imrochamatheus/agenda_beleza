'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { TextoDeConsentimento } from '@/components/consentimento/CaixasConsentimento';
import { CAMPOS_AVALIACAO } from '@/config/avaliacao';
import { ROTAS } from '@/config/navegacao';
import { LIMITE_COMENTARIO, MENSAGEM_LINK_INVALIDO, MENSAGENS_AVALIACAO } from '@/server/avaliacoes/tipos';
import type { DadosDoWidget } from '@/server/protecao/widget-tipos';
import { WidgetTurnstile } from '@/app/(publico)/[slug]/_componentes/WidgetTurnstile';

import { ESTADO_INICIAL_AVALIACAO } from './estado';
import type { AcaoAvaliar } from './estado';
import estilos from './FormularioAvaliacao.module.css';

export type FormularioAvaliacaoProps = {
  acao: AcaoAvaliar;
  slug: string;
  /** Token do link (só no campo oculto, e só quando o link é válido). */
  token: string;
  nomeSalao: string;
  /** Veredito da página no GET; o estado da ação prevalece (re-render do POST sem JS). */
  verificacao: 'valido' | 'invalido' | 'limitado';
  humano: DadosDoWidget;
};

const NOTAS = ['1', '2', '3', '4', '5'] as const;

/**
 * Avaliação pelo link do convite (D-032). Um único `useActionState`; funciona por POST sem JavaScript.
 * Link recusado: sempre a mesma tela, sem nenhum dado da reserva. O token só vai ao campo oculto.
 */
export function FormularioAvaliacao({ acao, slug, token, nomeSalao, verificacao, humano }: FormularioAvaliacaoProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_AVALIACAO);
  const visao = estado.status === 'inicial' ? (verificacao === 'valido' ? 'editando' : verificacao) : estado.status;

  if (visao === 'enviada') {
    return (
      <section className={estilos.bloco}>
        <h1>Avaliação enviada</h1>
        <Alert variante="sucesso">{estado.mensagem ?? MENSAGENS_AVALIACAO.enviada}</Alert>
        <p>
          <a href={ROTAS.salaoPublico(slug)}>Ver a página do salão</a>
        </p>
      </section>
    );
  }

  if (visao === 'invalido' || visao === 'limitado') {
    return (
      <section className={estilos.bloco}>
        <h1>Link inválido</h1>
        <Alert variante="erro">{visao === 'limitado' ? (estado.mensagem ?? MENSAGENS_AVALIACAO.limitado) : MENSAGEM_LINK_INVALIDO}</Alert>
      </section>
    );
  }

  const { erros, valores } = estado;
  return (
    <section className={estilos.bloco} aria-labelledby="avaliar-titulo">
      <h1 id="avaliar-titulo">Avalie {nomeSalao}</h1>
      <form action={enviar} className={estilos.bloco} noValidate>
        <input type="hidden" name={CAMPOS_AVALIACAO.slug} value={slug} />
        <input type="hidden" name={CAMPOS_AVALIACAO.token} value={token} />
        {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
        <fieldset
          className={estilos.notas}
          aria-describedby={erros.nota ? 'avaliar-nota-erro' : undefined}
        >
          <legend>Nota de 1 a 5 (obrigatório)</legend>
          {NOTAS.map((n) => (
            <label key={n} className={estilos.nota}>
              <input type="radio" name={CAMPOS_AVALIACAO.nota} value={n} defaultChecked={valores.nota === n} />
              <span>{n}</span>
            </label>
          ))}
        </fieldset>
        {erros.nota ? (
          <p id="avaliar-nota-erro" className={estilos.erro}>
            <strong>Erro:</strong> {erros.nota}
          </p>
        ) : null}
        <div className={estilos.campo}>
          <label htmlFor="avaliar-comentario">Comentário (opcional)</label>
          <textarea
            id="avaliar-comentario"
            name={CAMPOS_AVALIACAO.comentario}
            className={estilos.texto}
            rows={5}
            defaultValue={valores.comentario}
            aria-invalid={erros.comentario ? true : undefined}
            aria-describedby={erros.comentario ? 'avaliar-comentario-ajuda avaliar-comentario-erro' : 'avaliar-comentario-ajuda'}
          />
          <p id="avaliar-comentario-ajuda" className={estilos.ajuda}>
            Até {LIMITE_COMENTARIO} caracteres.
          </p>
          {erros.comentario ? (
            <p id="avaliar-comentario-erro" className={estilos.erro}>
              <strong>Erro:</strong> {erros.comentario}
            </p>
          ) : null}
        </div>
        <Checkbox
          id="avaliar-aceite"
          name={CAMPOS_AVALIACAO.aceite}
          rotulo={<TextoDeConsentimento finalidade="publicacao_avaliacao" />}
          obrigatorio
          erro={erros.aceite}
          defaultChecked={valores.aceite}
        />
        <WidgetTurnstile dados={humano} />
        <div>
          <Button type="submit" ocupado={pendente} rotuloOcupado="Enviando…">
            Enviar avaliação
          </Button>
        </div>
      </form>
    </section>
  );
}
