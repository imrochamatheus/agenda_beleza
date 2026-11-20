'use client';

import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ErroDoCampo } from '@/components/ui/Field';
import { ROTAS } from '@/config/navegacao';
import { LIMITES_SALAO, MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';

import estilos from './Configuracoes.module.css';
import { estadoSlugInicial, idDoCampo } from './estado';
import type { EstadoSlug } from './estado';

export type FormularioSlugProps = {
  acao: (anterior: EstadoSlug, formData: FormData) => Promise<EstadoSlug>;
  slugAtual: string;
  /** Slugs anteriores do salão (criado_em desc). */
  anteriores: readonly string[];
};

const ID_SLUG = idDoCampo('slug');
const ID_RESUMO = 'config-slug-resumo';
const ID_SUCESSO = 'config-slug-sucesso';
const ROTULO = 'Novo endereço';

/**
 * "Endereço público" (D-017 RN-12..RN-14, RN-19). O endereço atual e os anteriores aparecem como TEXTO
 * (D-16: a página pública é da E4.1). Funciona sem JavaScript; resumo de erros e sucesso focados.
 */
export function FormularioSlug({ acao, slugAtual, anteriores }: FormularioSlugProps) {
  const [estado, enviar, pendente] = useActionState(acao, estadoSlugInicial());
  const resumo = useRef<HTMLDivElement>(null);
  const sucesso = useRef<HTMLDivElement>(null);
  const erro = estado.erros.slug;

  useEffect(() => {
    if (erro) resumo.current?.focus();
    else if (estado.sucesso) sucesso.current?.focus();
  }, [estado, erro]);

  const descricao = [`${ID_SLUG}-ajuda`, erro ? `${ID_SLUG}-erro` : ''].filter(Boolean).join(' ');

  return (
    <div className={estilos.slug}>
      <p className={estilos.enderecoAtual}>
        Endereço público atual: <strong className={estilos.endereco}>{ROTAS.salaoPublico(slugAtual)}</strong>
      </p>
      <form action={enviar} className={estilos.formulario} noValidate>
        {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
        {erro ? (
          <div ref={resumo} id={ID_RESUMO} tabIndex={-1} className={estilos.resumoErros} role="alert" aria-labelledby={`${ID_RESUMO}-titulo`}>
            <p id={`${ID_RESUMO}-titulo`} className={estilos.resumoTitulo}>
              {M.resumoErros}
            </p>
            <ul>
              <li>
                <a href={`#${ID_SLUG}`}>
                  {ROTULO}: {erro}
                </a>
              </li>
            </ul>
          </div>
        ) : null}
        {estado.sucesso && !erro ? (
          <div ref={sucesso} id={ID_SUCESSO} tabIndex={-1} className={estilos.sucesso}>
            <Alert variante="sucesso">{estado.sucesso}</Alert>
          </div>
        ) : null}
        <div className={estilos.campo}>
          <label htmlFor={ID_SLUG} className={estilos.rotulo}>
            {ROTULO}
          </label>
          <p id={`${ID_SLUG}-ajuda`} className={estilos.ajuda}>
            {M.ajudaSlug}
          </p>
          <div className={estilos.prefixado}>
            <span className={estilos.prefixo} aria-hidden="true">
              /
            </span>
            <input
              id={ID_SLUG}
              name="slug"
              type="text"
              className={estilos.controlePrefixado}
              maxLength={LIMITES_SALAO.slug.max}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              defaultValue={estado.valor}
              aria-describedby={descricao}
              aria-invalid={erro ? true : undefined}
              key={`slug-${estado.valor}-${estado.sucesso ?? ''}`}
            />
          </div>
          {erro ? <ErroDoCampo id={`${ID_SLUG}-erro`} texto={erro} /> : null}
        </div>
        <div className={estilos.acoes}>
          <Button type="submit" ocupado={pendente} rotuloOcupado="Trocando…">
            Trocar endereço
          </Button>
        </div>
      </form>
      <section className={estilos.anteriores} aria-labelledby="config-slug-anteriores">
        <h3 id="config-slug-anteriores">Endereços anteriores</h3>
        {anteriores.length > 0 ? (
          <ul className={estilos.listaAnteriores}>
            {anteriores.map((s) => (
              <li key={s}>{ROTAS.salaoPublico(s)}</li>
            ))}
          </ul>
        ) : (
          <p className={estilos.ajuda}>{M.semAnteriores}</p>
        )}
      </section>
    </div>
  );
}
