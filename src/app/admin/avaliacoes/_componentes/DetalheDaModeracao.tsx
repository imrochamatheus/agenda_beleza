import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { CAMPOS_MODERACAO } from '@/config/moderacao';
import { MENSAGENS_MODERACAO, MOTIVO_MODERACAO_MAX, ROTULOS_MOTIVO } from '@/server/denuncias/tipos';
import type { DetalheDaAvaliacao } from '@/server/denuncias/tipos';

import { TEXTOS_RESULTADO } from '../resultado';
import type { CodigoResultado } from '../resultado';
import { rotuloDeData } from './FilaDeAvaliacoes';
import estilos from './Moderacao.module.css';

export type AcoesDeModeracao = {
  retirar: (fd: FormData) => Promise<void>;
  restaurar: (fd: FormData) => Promise<void>;
  arquivar: (fd: FormData) => Promise<void>;
};

export type DetalheDaModeracaoProps = {
  detalhe: DetalheDaAvaliacao;
  acoes: AcoesDeModeracao;
  resultado: CodigoResultado | null;
  hrefDaFila: string;
};

/**
 * Detalhe da moderação (D-035): avaliação, denúncias (o texto de cada uma é só do admin) e os três
 * formulários, cada um um POST simples com PRG (sem JavaScript). Texto sempre como texto, nunca HTML.
 */
export function DetalheDaModeracao({ detalhe: d, acoes, resultado, hrefDaFila }: DetalheDaModeracaoProps) {
  const pendentes = d.denuncias.filter((x) => x.resolvidaEm === null);
  const aviso = resultado === null ? null : TEXTOS_RESULTADO[resultado];
  return (
    <div className={estilos.pagina}>
      <p>
        <a href={hrefDaFila}>Voltar à fila</a>
      </p>
      <h1>Moderar avaliação</h1>
      {aviso ? <Alert variante={aviso.variante}>{aviso.texto}</Alert> : null}
      <section className={estilos.cartao} aria-labelledby="avaliacao-titulo">
        <h2 id="avaliacao-titulo">Avaliação</h2>
        <p>
          <strong>{d.salaoNome}</strong> · Nota {d.nota} de 5 · {d.nome ?? 'Cliente removida'}
        </p>
        {d.comentario !== null ? <p>{d.comentario}</p> : null}
        <p className={estilos.suave}>Enviada em {rotuloDeData(d.criadoEm)}</p>
        <p>
          {d.retiradaEm === null ? 'Visível na página pública.' : `Retirada da página pública em ${rotuloDeData(d.retiradaEm)}.`}
          {d.naoPublicada ? ' Não publicada de qualquer forma (reserva ou cliente).' : ''}
        </p>
      </section>

      <section aria-labelledby="denuncias-titulo" className={estilos.pagina}>
        <h2 id="denuncias-titulo">Denúncias</h2>
        {d.denuncias.length === 0 ? (
          <p>Nenhuma denúncia.</p>
        ) : (
          <ul className={estilos.denuncias}>
            {d.denuncias.map((x) => (
              <li key={x.id} className={estilos.denuncia}>
                <p>
                  <strong>{ROTULOS_MOTIVO[x.motivo]}</strong> · {rotuloDeData(x.criadoEm)}
                </p>
                {x.texto !== null ? <p>{x.texto}</p> : null}
                {x.resolvidaEm === null ? (
                  <form action={acoes.arquivar}>
                    <input type="hidden" name={CAMPOS_MODERACAO.avaliacao} value={d.id} />
                    <input type="hidden" name={CAMPOS_MODERACAO.denuncia} value={x.id} />
                    <Button type="submit" variante="secundaria">
                      Arquivar esta denúncia
                    </Button>
                  </form>
                ) : (
                  <p className={estilos.suave}>
                    {x.resolucao === 'retirada' ? 'Resolvida com a retirada' : 'Arquivada, avaliação mantida'} em {rotuloDeData(x.resolvidaEm)}.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {pendentes.length > 1 ? (
          <form action={acoes.arquivar}>
            <input type="hidden" name={CAMPOS_MODERACAO.avaliacao} value={d.id} />
            <Button type="submit" variante="secundaria">
              Arquivar todas as pendentes ({pendentes.length})
            </Button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="moderar-titulo" className={estilos.pagina}>
        <h2 id="moderar-titulo">{d.retiradaEm === null ? 'Retirar da página pública' : 'Restaurar na página pública'}</h2>
        <form action={d.retiradaEm === null ? acoes.retirar : acoes.restaurar} className={estilos.formulario}>
          <input type="hidden" name={CAMPOS_MODERACAO.avaliacao} value={d.id} />
          <Field
            name={CAMPOS_MODERACAO.motivo}
            rotulo="Motivo da moderação"
            obrigatorio
            maxLength={MOTIVO_MODERACAO_MAX}
            autoComplete="off"
            ajuda={MENSAGENS_MODERACAO.avisoDados}
          />
          <div>
            <Button type="submit" variante={d.retiradaEm === null ? 'perigo' : 'primaria'}>
              {d.retiradaEm === null ? 'Retirar avaliação' : 'Restaurar avaliação'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
