import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { formatarDataHora, formatarInteiro } from '@/lib/format';
import { ESTADOS_FILA, ROTULOS_ESTADO, ROTULOS_MOTIVO } from '@/server/denuncias/tipos';
import type { FilaModeracao } from '@/server/denuncias/tipos';
import type { FiltrosFila } from '@/server/denuncias/validacao';

import estilos from './Moderacao.module.css';

export const rotuloDeData = (d: Date): string => `${formatarDataHora(d, 'UTC')} UTC`;

export type FilaDeAvaliacoesProps = {
  fila: FilaModeracao;
  filtros: FiltrosFila;
  /** Caminho da própria fila (GET dos filtros e da paginação). */
  base: string;
  /** Caminho do detalhe de uma avaliação (a vitrine usa outro). */
  hrefDoDetalhe: (id: string) => string;
};

function href(base: string, f: FiltrosFila, pagina: number): string {
  const q = new URLSearchParams();
  if (f.salaoId !== null) q.set('salao', f.salaoId);
  if (f.estado !== null) q.set('estado', f.estado);
  if (pagina > 1) q.set('pagina', String(pagina));
  const s = q.toString();
  return s === '' ? base : `${base}?${s}`;
}

/**
 * Fila de moderação (D-035 RN-7): filtros por GET (funcionam sem JavaScript), lista de cartões (cabe em
 * 375 px), 20 por página. Nome de exibição e comentário saem como TEXTO (o React escapa); nunca telefone,
 * e-mail nem id da cliente. Datas em UTC, rotuladas.
 */
export function FilaDeAvaliacoes({ fila, filtros, base, hrefDoDetalhe }: FilaDeAvaliacoesProps) {
  const paginas = Math.max(1, Math.ceil(fila.total / fila.porPagina));
  return (
    <div className={estilos.pagina}>
      <form method="get" action={base} className={estilos.filtros}>
        {filtros.salaoId !== null ? <input type="hidden" name="salao" value={filtros.salaoId} /> : null}
        <Select
          name="estado"
          rotulo="Estado"
          defaultValue={filtros.estado ?? ''}
          textoVazio="Todos"
          opcoes={ESTADOS_FILA.map((e) => ({ valor: e, rotulo: ROTULOS_ESTADO[e] }))}
        />
        <Button type="submit">Filtrar</Button>
        {filtros.salaoId !== null ? <a href={href(base, { ...filtros, salaoId: null }, 1)}>Mostrar todos os salões</a> : null}
      </form>
      <p className={estilos.suave} aria-live="polite">
        {formatarInteiro(fila.total)} {fila.total === 1 ? 'avaliação' : 'avaliações'}
        {filtros.salaoId !== null ? ' neste salão' : ''}
      </p>
      {fila.itens.length === 0 ? (
        <p>Nenhuma avaliação com esses filtros.</p>
      ) : (
        <ul className={estilos.lista}>
          {fila.itens.map((a) => (
            <li key={a.id} className={estilos.cartao}>
              <p>
                <strong>{a.salaoNome}</strong> · Nota {a.nota} de 5 · {a.nome ?? 'Cliente removida'}
              </p>
              {a.comentario !== null ? <p>{a.comentario}</p> : null}
              <p className={estilos.suave}>Enviada em {rotuloDeData(a.criadoEm)}</p>
              <ul className={estilos.selos} aria-label="Situação">
                <li className={estilos.selo}>{a.retiradaEm === null ? 'Visível' : `Retirada em ${rotuloDeData(a.retiradaEm)}`}</li>
                {a.pendentes > 0 ? (
                  <li className={estilos.selo}>
                    {a.pendentes} {a.pendentes === 1 ? 'denúncia pendente' : 'denúncias pendentes'}: {a.motivos.map((m) => ROTULOS_MOTIVO[m]).join(', ')}
                  </li>
                ) : null}
                {a.naoPublicada ? <li className={estilos.selo}>Não publicada (reserva ou cliente)</li> : null}
              </ul>
              <p>
                <a href={hrefDoDetalhe(a.id)} aria-label={`Moderar avaliação de ${a.nome ?? 'cliente removida'} em ${a.salaoNome}`}>
                  Moderar
                </a>{' '}
                {filtros.salaoId === null ? (
                  <a href={href(base, { ...filtros, salaoId: a.salaoId }, 1)} aria-label={`Só este salão: ${a.salaoNome}`}>
                    Só este salão
                  </a>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
      {paginas > 1 ? (
        <nav aria-label="Paginação" className={estilos.paginacao}>
          {fila.pagina > 1 ? <a href={href(base, filtros, fila.pagina - 1)}>Anterior</a> : null}
          <span>
            Página {fila.pagina} de {paginas}
          </span>
          {fila.pagina < paginas ? <a href={href(base, filtros, fila.pagina + 1)}>Próxima</a> : null}
        </nav>
      ) : null}
    </div>
  );
}
