import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FaixaDeDias } from '@/components/ui/FaixaDeDias';
import { RoteiroDoDia } from '@/components/ui/RoteiroDoDia';
import type { ParadaDoRoteiro } from '@/components/ui/RoteiroDoDia';
import { SlotGrid } from '@/components/ui/SlotGrid';
import { formatarDuracao, formatarHora, formatarMoeda } from '@/lib/format';
import {
  camposOcultos,
  hrefAlterarItem,
  hrefAlterarServicos,
  hrefFiltro,
  hrefOutroDia,
  lerItem,
} from '@/server/reserva-publica/passos';
import { MENSAGENS_AVISO, MENSAGENS_PASSO } from '@/server/reserva-publica/tipos';
import type {
  CodigoAviso,
  ConsultaDaUrl,
  FaixaDaSemana,
  ItemEscolhido,
  ProfissionalComHorarios,
  Selecao,
  ServicoDaSelecao,
  VisaoDoPasso,
} from '@/server/reserva-publica/tipos';
import type { ServicoPublico } from '@/server/repos/publico';

import { estadoSemDia, propsDaFaixa, rotuloDoDia } from './faixa';
import { FiltroDeProfissional } from './FiltroDeProfissional';
import estilos from './Salao.module.css';

// Passos do fluxo público (D-026; D-050 web-design §5.1–5.4, §5.7). Componentes sem estado: também são
// importados pelo `FormularioDados` (cliente), por isso só recebem texto e dados serializáveis.

type Visao<P extends VisaoDoPasso['passo']> = Extract<VisaoDoPasso, { passo: P }>;

function Aviso({ codigo }: { codigo: CodigoAviso | null }) {
  return codigo ? <Alert variante="aviso">{MENSAGENS_AVISO[codigo]}</Alert> : null;
}

// O `FormularioDados` importa `rotuloDoDia` daqui; a implementação mora em `faixa.ts` (D-051 §3.6).
export { rotuloDoDia };

/** "1 serviço", "3 serviços". */
export const quantidadeDeServicos = (n: number): string => `${n} ${n === 1 ? 'serviço' : 'serviços'}`;

/** Campos ocultos (GET de um passo ou POST de dados). */
export function CamposOcultos({ campos }: { campos: readonly { name: string; value: string }[] }) {
  return (
    <>
      {campos.map((c) => (
        <input key={`${c.name}=${c.value}`} type="hidden" name={c.name} value={c.value} />
      ))}
    </>
  );
}

/** Serviços escolhidos em uma linha e o total (passo do dia). Sem duração total (D4). */
export function ResumoDaSelecao({ selecao }: { selecao: Selecao }) {
  return (
    <div className={estilos.resumo} aria-label="Serviços escolhidos" role="group">
      <p className={estilos.servicos}>{selecao.servicos.map((s) => s.nome).join(' · ')}</p>
      <p className={estilos.suave}>
        {quantidadeDeServicos(selecao.servicos.length)} · {formatarMoeda(selecao.precoTotalCentavos)}
      </p>
    </div>
  );
}

/** "1 h · R$ 90,00". */
export const detalheDoServico = (duracaoMin: number, precoCentavos: number): string =>
  `${formatarDuracao(duracaoMin)} · ${formatarMoeda(precoCentavos)}`;

/**
 * Link "Alterar" de um item escolhido: visível "Alterar"; o nome acessível completa com o serviço, a hora e o
 * profissional ("Alterar Escova (09:00 com Ana)") e começa pelo texto visível (web-design §5.4).
 */
export function LinkAlterar({ href, item, fuso }: { href: string; item: ItemEscolhido; fuso: string }) {
  return (
    <a href={href} className={estilos.alterar}>
      Alterar{' '}
      <span className="visualmente-oculto">
        {item.servicoNome} ({formatarHora(new Date(item.inicioIso), fuso)} com {item.profissionalNome})
      </span>
    </a>
  );
}

/** Parada "escolhida" do roteiro para um item (com o "Alterar" opcional). */
export function paradaDoItem(item: ItemEscolhido, fuso: string, acoes?: ParadaDoRoteiro['acoes']): ParadaDoRoteiro {
  return {
    chave: `item-${item.indice}`,
    hora: formatarHora(new Date(item.inicioIso), fuso),
    servico: item.servicoNome,
    profissional: item.profissionalNome,
    detalhe: detalheDoServico(item.duracaoMin, item.precoCentavos),
    estado: 'escolhida',
    acoes,
  };
}

/**
 * Grades de horário de UM serviço, agrupadas por profissional (web-design §4.2, §5.3): todas com o mesmo `name`
 * (uma parada de Tab, uma escolha) e o profissional no prefixo do valor. Quem não tem horário vem por último,
 * com "Sem horários livres neste dia.". A pré-seleção casa o valor completo (profissional + instante).
 */
export function GradesPorProfissional({
  profissionais,
  fuso,
  name,
  preSelecionado,
  nivel = 3,
}: {
  profissionais: readonly ProfissionalComHorarios[];
  fuso: string;
  name: string;
  preSelecionado: string | null;
  nivel?: 3 | 4;
}) {
  const atual = preSelecionado === null ? null : lerItem(preSelecionado);
  const ordenados = [
    ...profissionais.filter((p) => p.horarios.length > 0),
    ...profissionais.filter((p) => p.horarios.length === 0),
  ];
  const Titulo = nivel === 4 ? 'h4' : 'h3';
  return (
    <div className={estilos.grades}>
      {ordenados.map((p) => (
        <div key={p.id} className={estilos.grupoProfissional}>
          <Titulo className={estilos.nomeProfissional}>{p.nome}</Titulo>
          {p.horarios.length === 0 ? (
            <p className={estilos.suave}>{MENSAGENS_PASSO.profissionalSemHorario}</p>
          ) : (
            <SlotGrid
              instantes={p.horarios.map((h) => new Date(h))}
              fuso={fuso}
              rotuloGrupo={`Horários de ${p.nome}`}
              name={name}
              prefixoDoValor={`${p.id}_`}
              nivelLegenda="discreta"
              selecionadoInicial={atual !== null && atual.profissionalId === p.id.toLowerCase() ? atual.inicio : null}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function PassoServicos({ base, servicos, visao }: { base: string; servicos: readonly ServicoPublico[]; visao: Visao<'servicos'> }) {
  const marcados = new Set(visao.marcados);
  return (
    <form method="get" action={base} className={estilos.reserva}>
      <h2 id="reservar">Serviços</h2>
      <Aviso codigo={visao.aviso} />
      <p>
        Escolha um ou mais serviços (até 10). Depois você escolhe o dia e, para cada serviço, o profissional e o
        horário.
      </p>
      <fieldset className={estilos.opcoes}>
        <legend className="visualmente-oculto">Serviços</legend>
        {servicos.map((s) => (
          <label key={s.id} className={estilos.opcao}>
            <input type="checkbox" name="s" value={s.id} defaultChecked={marcados.has(s.id.toLowerCase())} />
            <span className={estilos.opcaoTexto}>
              <span>{s.nome}</span>
              <span className={estilos.suave}>{detalheDoServico(s.duracaoMin, s.precoCentavos)}</span>
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

const ID_INDICADOR = 'reservar-indicador';

/**
 * Cabeçalho do passo de um serviço (D-051 §3.6, web-design §5.1): indicador "Serviço k de N", `h2#reservar`
 * descrito por ele, duração e preço e o aviso (antes da régua no DOM, critério 13).
 */
function CabecalhoDoPasso({
  indice,
  total,
  servico,
  aviso,
}: {
  indice: number;
  total: number;
  servico: ServicoDaSelecao;
  aviso: string | null;
}) {
  return (
    <>
      <p id={ID_INDICADOR} className={estilos.indicador}>
        {MENSAGENS_PASSO.indicador(indice + 1, total)}
      </p>
      <h2 id="reservar" aria-describedby={ID_INDICADOR}>
        {servico.nome}
      </h2>
      <p className={estilos.suave}>{detalheDoServico(servico.duracaoMin, servico.precoCentavos)}</p>
      {aviso ? <Alert variante="aviso">{aviso}</Alert> : null}
    </>
  );
}

/** Resumo dos serviços e a régua da semana (passo do serviço 0, com ou sem dia; D-051 RN-1). */
function ResumoEFaixa({ base, s, selecao, faixa }: { base: string; s: readonly string[]; selecao: Selecao; faixa: FaixaDaSemana }) {
  return (
    <>
      <ResumoDaSelecao selecao={selecao} />
      <FaixaDeDias {...propsDaFaixa(base, s, faixa)} className={estilos.faixaNoCartao} />
    </>
  );
}

/**
 * Passo do serviço 0 sem dia escolhido (D-051 RN-7, RN-9): régua da semana e, no lugar dos horários, o estado
 * vazio. Sem `<form>` (D6): os dias e as semanas são links GET.
 */
export function PassoDia({ base, visao }: { base: string; visao: Visao<'dia'> }) {
  const vazio = estadoSemDia(visao.faixa, visao.servico.nome);
  return (
    <section className={estilos.reserva} aria-labelledby="reservar">
      <CabecalhoDoPasso
        indice={0}
        total={visao.total}
        servico={visao.servico}
        aviso={visao.aviso === null ? null : MENSAGENS_AVISO[visao.aviso]}
      />
      <ResumoEFaixa base={base} s={visao.s} selecao={visao.selecao} faixa={visao.faixa} />
      <div className={estilos.horarios}>
        <EmptyState nivelTitulo={3} titulo={vazio.titulo} descricao={<p>{vazio.texto}</p>} />
      </div>
      <ul className={estilos.navegacao}>
        <li>
          <a href={hrefAlterarServicos(base, { s: visao.s })}>Alterar serviços</a>
        </li>
      </ul>
    </section>
  );
}

/** Texto do aviso do passo de um serviço (5.7): os que nomeiam o serviço vêm de `MENSAGENS_PASSO`. */
function textoDoAviso(visao: Visao<'servico'>): string | null {
  const servico = visao.servico.nome;
  if (visao.aviso === null) return null;
  if (visao.aviso === 'sem_selecao') return MENSAGENS_PASSO.semSelecao(servico);
  if (visao.aviso === 'horario_indisponivel' && visao.horarioPerdidoIso !== null) {
    return MENSAGENS_PASSO.horarioPerdido(formatarHora(new Date(visao.horarioPerdidoIso), visao.fuso), servico);
  }
  return MENSAGENS_AVISO[visao.aviso];
}

/** Roteiro do passo de um serviço: escolhidos (com "Alterar"), o serviço em escolha e os pendentes. */
function paradasDoPasso(base: string, visao: Visao<'servico'>, consulta: ConsultaDaUrl): ParadaDoRoteiro[] {
  const escolhidas = visao.escolhidos.map((item) =>
    paradaDoItem(item, visao.fuso, <LinkAlterar href={hrefAlterarItem(base, consulta, item.indice)} item={item} fuso={visao.fuso} />),
  );
  const abertos = [visao.indice, ...visao.pendentes].sort((a, b) => a - b).map((k): ParadaDoRoteiro => {
    const servico = visao.selecao.servicos[k];
    const atual = k === visao.indice;
    return {
      chave: `item-${k}`,
      hora: null,
      servico: servico.nome,
      detalhe: atual ? (visao.alterando ? 'alterando' : 'escolhendo agora') : 'a escolher',
      estado: atual ? 'destaque' : 'pendente',
    };
  });
  return [...escolhidas, ...abertos];
}

/**
 * Passo "Serviço k de N" (web-design §5.3): GET com os itens dos outros serviços em campos ocultos e as
 * grades deste serviço (um `name` por serviço). Ordem de leitura: indicador → título → roteiro → filtro →
 * grades → "Continuar" → navegação. No serviço 0 (`faixa` presente, D-051) entram o resumo e a régua antes
 * dos horários, que ficam num bloco com traço no topo, e "Escolher outro dia" sai (a régua cumpre o papel).
 */
export function PassoServico({ base, visao }: { base: string; visao: Visao<'servico'> }) {
  const consulta = visao.consulta;
  const nome = visao.servico.nome;
  const faixa = visao.faixa;
  const filtros = [
    { id: null, rotulo: `Todos (${visao.opcoesDeFiltro.length})` },
    ...visao.opcoesDeFiltro.map((p) => ({ id: p.id, rotulo: p.nome })),
  ].map((o) => ({
    rotulo: o.rotulo,
    href: hrefFiltro(base, consulta, o.id, visao.alterando ? visao.indice : null),
    atual: o.id === visao.filtro,
  }));
  const horarios = (
    <>
      <RoteiroDoDia rotulo="Seu dia" titulo={rotuloDoDia(visao.data)} paradas={paradasDoPasso(base, visao, consulta)} />
      <CamposOcultos campos={camposOcultos(consulta, visao.indice)} />
      {visao.vazio !== null ? (
        <EmptyState
          nivelTitulo={3}
          titulo={visao.vazio === 'conflito' ? MENSAGENS_PASSO.vazioConflitoTitulo(nome) : MENSAGENS_PASSO.vazioCalendarioTitulo(nome)}
          descricao={<p>{visao.vazio === 'conflito' ? MENSAGENS_PASSO.vazioConflitoTexto : MENSAGENS_PASSO.vazioCalendarioTexto}</p>}
        />
      ) : (
        <>
          {visao.opcoesDeFiltro.length >= 2 ? <FiltroDeProfissional opcoes={filtros} /> : null}
          <GradesPorProfissional
            profissionais={visao.profissionais}
            fuso={visao.fuso}
            name={`h${visao.indice}`}
            preSelecionado={visao.preSelecionado}
          />
          <div className={estilos.acoes}>
            <Button type="submit">{visao.proximoEhDados ? MENSAGENS_PASSO.continuarParaDados : MENSAGENS_PASSO.continuar}</Button>
          </div>
        </>
      )}
    </>
  );
  return (
    <form method="get" action={base} className={estilos.reserva}>
      <CabecalhoDoPasso indice={visao.indice} total={visao.total} servico={visao.servico} aviso={textoDoAviso(visao)} />
      {faixa !== null ? (
        <>
          <ResumoEFaixa base={base} s={visao.s} selecao={visao.selecao} faixa={faixa} />
          <div className={estilos.horarios}>{horarios}</div>
        </>
      ) : (
        horarios
      )}
      <ul className={estilos.navegacao}>
        {faixa === null ? (
          <li>
            <a href={hrefOutroDia(base, consulta)}>Escolher outro dia</a>
          </li>
        ) : null}
        <li>
          <a href={hrefAlterarServicos(base, consulta)}>Alterar serviços</a>
        </li>
      </ul>
    </form>
  );
}

/** Cabeçalho do passo de dados (web-design §5.4): roteiro com "Alterar" por item, total e "Alterar serviços". */
export function CabecalhoDados({ base, visao }: { base: string; visao: Visao<'dados'> }) {
  return (
    <>
      <h2 id="reservar">Seus dados</h2>
      <RoteiroDoDia
        rotulo="Seu dia"
        titulo={rotuloDoDia(visao.data)}
        paradas={visao.itens.map((item) =>
          paradaDoItem(item, visao.fuso, <LinkAlterar href={hrefAlterarItem(base, visao.consulta, item.indice)} item={item} fuso={visao.fuso} />),
        )}
        rodape={<Total centavos={visao.totalCentavos} quantidade={visao.itens.length} />}
      />
      <ul className={estilos.navegacao}>
        <li>
          <a href={hrefAlterarServicos(base, visao.consulta)}>Alterar serviços</a>
        </li>
      </ul>
    </>
  );
}

/** Total (soma dos itens, RN-35) e a quantidade de serviços; nunca a duração total (D4). */
export function Total({ centavos, quantidade }: { centavos: number; quantidade: number }) {
  return (
    <div className={estilos.total}>
      <p className={estilos.totalLinha}>
        <span>Total</span>
        <span>{formatarMoeda(centavos)}</span>
      </p>
      <p className={estilos.suave}>{quantidadeDeServicos(quantidade)}</p>
    </div>
  );
}
