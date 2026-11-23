import { formatarFaixaDeMinutos, formatarMinutosDoDia } from '@/lib/format';
import { distribuirLadoALado, recortarNoDia } from '@/server/agenda/faixas';
import { MENSAGENS_AGENDA } from '@/server/agenda/tipos';
import type { AgendaVista, BlocoDaAgenda, BloqueioDaAgenda, ColunaDaAgenda, FaixaDoDia } from '@/server/agenda/tipos';

import estilos from './Agenda.module.css';
import { EventoDoBloco, hrefDoBloco, rotuloDoBloqueio } from './Eventos';

type Props = { vista: AgendaVista; hrefReserva: (id: string) => string };

const REM_POR_MINUTO = 0.1;
const rem = (min: number) => `${(min * REM_POR_MINUTO).toFixed(2)}rem`;

type EventoNaGrade =
  | (FaixaDoDia & { tipo: 'item'; bloco: BlocoDaAgenda })
  | (FaixaDoDia & { tipo: 'bloqueio'; bloqueio: BloqueioDaAgenda });

/** Uma trilha de 00:00 a 24:00 por profissional; itens (D-050: um bloco por item) e bloqueios lado a lado quando se sobrepõem. */
function Trilha({ vista, coluna, hrefReserva }: { vista: AgendaVista; coluna: ColunaDaAgenda; hrefReserva: Props['hrefReserva'] }) {
  const dia = vista.dias[0];
  const eventos: EventoNaGrade[] = [];
  for (const b of coluna.blocos) {
    const f = recortarNoDia(b.inicio, b.fim, dia, vista.fuso);
    if (f) eventos.push({ ...f, tipo: 'item', bloco: b });
  }
  for (const b of coluna.bloqueios) {
    const f = recortarNoDia(b.inicio, b.fim, dia, vista.fuso);
    if (f) eventos.push({ ...f, tipo: 'bloqueio', bloqueio: b });
  }
  const posicionados = distribuirLadoALado(eventos);
  const foraDaJornada = coluna.foraDaJornada[dia.iso] ?? [];
  return (
    <div className={estilos.trilha} style={{ height: rem(1440) }}>
      {Array.from({ length: 24 }, (_, h) => (
        <p key={h} className={estilos.hora} style={{ top: rem(h * 60) }} aria-hidden="true">
          {formatarMinutosDoDia(h * 60)}
        </p>
      ))}
      <div className={estilos.area}>
        {dia.foraDoFuncionamento.map((f) => (
          <div
            key={`s${f.inicioMin}`}
            className={`${estilos.faixa} ${estilos.faixaSalao}`}
            style={{ top: rem(f.inicioMin), height: rem(f.fimMin - f.inicioMin) }}
          >
            <span>
              {MENSAGENS_AGENDA.foraDoFuncionamento} {formatarFaixaDeMinutos(f.inicioMin, f.fimMin)}
            </span>
          </div>
        ))}
        {foraDaJornada.map((f) => (
          <div
            key={`j${f.inicioMin}`}
            className={`${estilos.faixa} ${estilos.faixaJornada}`}
            style={{ top: rem(f.inicioMin), height: rem(f.fimMin - f.inicioMin) }}
          >
            <span>
              {MENSAGENS_AGENDA.foraDaJornada} {formatarFaixaDeMinutos(f.inicioMin, f.fimMin)}
            </span>
          </div>
        ))}
        {posicionados.map((e) => {
          const estilo = {
            top: rem(e.inicioMin),
            height: rem(e.fimMin - e.inicioMin),
            left: `${(e.coluna / e.colunas) * 100}%`,
            width: `${100 / e.colunas}%`,
          };
          return e.tipo === 'item' ? (
            <EventoDoBloco key={`i${e.bloco.itemId}`} bloco={e.bloco} faixa={e} href={hrefDoBloco(hrefReserva, e.bloco)} estiloExtra={estilo} />
          ) : (
            <div key={`b${e.bloqueio.id}`} className={`${estilos.evento} ${estilos.bloqueio}`} style={estilo}>
              <strong>{formatarFaixaDeMinutos(e.inicioMin, e.fimMin)}</strong> {rotuloDoBloqueio(e.bloqueio)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Visão por dia: uma coluna por profissional (empilhadas no celular, lado a lado no desktop). */
export function GradeDoDia({ vista, hrefReserva }: Props) {
  const dia = vista.dias[0];
  return (
    <div className={estilos.colunas}>
      {dia.salaoFechado ? <p className={estilos.aviso}>{MENSAGENS_AGENDA.salaoFechado} neste dia.</p> : null}
      {vista.colunas.map((c) => (
        <section key={c.id} className={estilos.coluna} aria-labelledby={`coluna-${c.id}`}>
          <h3 id={`coluna-${c.id}`}>
            {c.nome}
            {c.ativo ? null : <span className={estilos.etiqueta}> ({MENSAGENS_AGENDA.inativo})</span>}
          </h3>
          <Trilha vista={vista} coluna={c} hrefReserva={hrefReserva} />
        </section>
      ))}
    </div>
  );
}
