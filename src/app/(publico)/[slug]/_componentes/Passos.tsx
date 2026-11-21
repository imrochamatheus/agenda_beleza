import { diaDaSemana } from '@/domain/disponibilidade';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SlotGrid } from '@/components/ui/SlotGrid';
import { formatarDataCivil, formatarDataHora, formatarDiaDaSemana, formatarDuracao, formatarMoeda } from '@/lib/format';
import { lerData, montarHref, QUALQUER } from '@/server/reserva-publica/passos';
import { MENSAGENS_AVISO } from '@/server/reserva-publica/tipos';
import type { CodigoAviso, Selecao, VisaoDoPasso } from '@/server/reserva-publica/tipos';
import type { ServicoPublico } from '@/server/repos/publico';

import estilos from './Salao.module.css';

type Visao<P extends VisaoDoPasso['passo']> = Extract<VisaoDoPasso, { passo: P }>;

function Aviso({ codigo }: { codigo: CodigoAviso | null }) {
  return codigo ? <Alert variante="aviso">{MENSAGENS_AVISO[codigo]}</Alert> : null;
}

/** 'Terça-feira, 01/12/2026' a partir de 'AAAA-MM-DD' (dia civil do salão, sem fuso). */
export function rotuloDoDia(chave: string): string {
  const d = lerData(chave);
  if (d === null) return chave;
  return `${formatarDiaDaSemana(diaDaSemana(d))}, ${formatarDataCivil(chave)}`;
}

/** Campos ocultos que carregam o estado do fluxo nos formulários GET. */
function Ocultos({ s, p, data }: { s?: readonly string[]; p?: string; data?: string }) {
  return (
    <>
      {(s ?? []).map((id) => (
        <input key={id} type="hidden" name="s" value={id} />
      ))}
      {p ? <input type="hidden" name="p" value={p} /> : null}
      {data ? <input type="hidden" name="data" value={data} /> : null}
    </>
  );
}

export function ResumoDaSelecao({ selecao, profissional, inicioIso, fuso }: {
  selecao: Selecao;
  profissional?: string;
  inicioIso?: string;
  fuso?: string;
}) {
  return (
    <div className={estilos.resumo} aria-label="Resumo da escolha" role="group">
      <p>
        <strong>{selecao.servicos.map((s) => s.nome).join(', ')}</strong>
      </p>
      {profissional ? <p>Profissional: {profissional}</p> : null}
      {inicioIso && fuso ? <p>Quando: {formatarDataHora(new Date(inicioIso), fuso)}</p> : null}
      <p className={estilos.suave}>
        {formatarDuracao(selecao.duracaoTotalMin)} · {formatarMoeda(selecao.precoTotalCentavos)}
      </p>
    </div>
  );
}

export function PassoServicos({ base, servicos, visao }: { base: string; servicos: readonly ServicoPublico[]; visao: Visao<'servicos'> }) {
  return (
    <form method="get" action={base} className={estilos.reserva}>
      <h2 id="reservar">Serviços</h2>
      <Aviso codigo={visao.aviso} />
      <p>Escolha um ou mais serviços (até 10). Eles são feitos em sequência, com o mesmo profissional.</p>
      <fieldset className={estilos.opcoes}>
        <legend className="visualmente-oculto">Serviços</legend>
        {servicos.map((s) => (
          <label key={s.id} className={estilos.opcao}>
            <input type="checkbox" name="s" value={s.id} />
            <span className={estilos.opcaoTexto}>
              <span>{s.nome}</span>
              <span className={estilos.suave}>
                {formatarDuracao(s.duracaoMin)} · {formatarMoeda(s.precoCentavos)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className={estilos.acoes}>
        <Button type="submit">Continuar</Button>
      </div>
    </form>
  );
}

export function PassoProfissional({ base, visao }: { base: string; visao: Visao<'profissional'> }) {
  return (
    <form method="get" action={base} className={estilos.reserva}>
      <h2 id="reservar">Profissional</h2>
      <Aviso codigo={visao.aviso} />
      <ResumoDaSelecao selecao={visao.selecao} />
      <Ocultos s={visao.s} />
      <fieldset className={estilos.opcoes}>
        <legend className="visualmente-oculto">Profissional</legend>
        <label className={estilos.opcao}>
          <input type="radio" name="p" value={QUALQUER} defaultChecked />
          <span className={estilos.opcaoTexto}>
            <span>Sem preferência</span>
            <span className={estilos.suave}>Escolhemos quem tem o horário que você preferir.</span>
          </span>
        </label>
        {visao.profissionais.map((p) => (
          <label key={p.id} className={estilos.opcao}>
            <input type="radio" name="p" value={p.id} />
            <span className={estilos.opcaoTexto}>{p.nome}</span>
          </label>
        ))}
      </fieldset>
      <ul className={estilos.navegacao}>
        <li>
          <a href={base}>Alterar serviços</a>
        </li>
      </ul>
      <div className={estilos.acoes}>
        <Button type="submit">Continuar</Button>
      </div>
    </form>
  );
}

export function PassoData({ base, visao }: { base: string; visao: Visao<'data'> }) {
  const q = { s: visao.s, p: visao.p };
  return (
    <section className={estilos.reserva} aria-labelledby="reservar">
      <h2 id="reservar">Escolha o dia</h2>
      <Aviso codigo={visao.aviso} />
      <ResumoDaSelecao selecao={visao.selecao} />
      <ul className={estilos.dias}>
        {visao.dias.map((d) => (
          <li key={d.data} className={estilos.dia}>
            {d.temHorarios ? (
              <a href={montarHref(base, { ...q, data: d.data })}>{rotuloDoDia(d.data)}</a>
            ) : (
              <span className={estilos.suave}>{rotuloDoDia(d.data)} (sem horários)</span>
            )}
          </li>
        ))}
      </ul>
      <ul className={estilos.navegacao}>
        {visao.anterior ? (
          <li>
            <a href={montarHref(base, { ...q, de: visao.anterior })}>Dias anteriores</a>
          </li>
        ) : null}
        {visao.proxima ? (
          <li>
            <a href={montarHref(base, { ...q, de: visao.proxima })}>Próximos dias</a>
          </li>
        ) : null}
        <li>
          <a href={montarHref(base, { s: visao.s })}>Alterar profissional</a>
        </li>
      </ul>
    </section>
  );
}

export function PassoHorario({ base, visao }: { base: string; visao: Visao<'horario'> }) {
  return (
    <form method="get" action={base} className={estilos.reserva}>
      <h2 id="reservar">Escolha o horário</h2>
      <Aviso codigo={visao.aviso} />
      <ResumoDaSelecao selecao={visao.selecao} />
      <Ocultos s={visao.s} p={visao.p} data={visao.data} />
      <SlotGrid
        instantes={visao.horarios.map((h) => new Date(h))}
        fuso={visao.fuso}
        rotuloGrupo={`Horários de ${rotuloDoDia(visao.data)}`}
        name="h"
        vazio={
          <EmptyState
            titulo="Nenhum horário disponível neste dia."
            nivelTitulo={3}
          />
        }
      />
      <ul className={estilos.navegacao}>
        <li>
          <a href={montarHref(base, { s: visao.s, p: visao.p })}>Escolher outro dia</a>
        </li>
      </ul>
      {visao.horarios.length > 0 ? (
        <div className={estilos.acoes}>
          <Button type="submit">Continuar</Button>
        </div>
      ) : null}
    </form>
  );
}
