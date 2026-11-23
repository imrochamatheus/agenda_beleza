// Dados em memória da vitrine /dev/reserva (D-026 §8, CA-12; D-050 web-design §8): o MESMO fluxo da página
// pública, sem banco. A derivação do passo e a validação são as funções puras reais (`lerPasso`, `camposOcultos`,
// validações da reserva); só a disponibilidade é fabricada aqui (grade fixa de 15 min, jornada por
// profissional, antecedência de 2 h, itens da cliente sem sobreposição), em horário de parede de São Paulo.
import { diaDaSemana } from '@/domain/disponibilidade';
import type { EstadoReserva, ReescolhaNoEstado } from '@/app/(publico)/[slug]/estado';
import { mensagemDaReescolha } from '@/app/(publico)/[slug]/formulario';
import { montarSemana } from '@/server/semana/montagem';
import type { PerfilPublico, ProfissionalPublico, ServicoPublico } from '@/server/repos/publico';
import { chaveDeData, inicioDaSemana, limitesDaSemana, valorDoItem, valoresDosItens } from '@/server/reserva-publica/passos';
import type { ItemDaUrl, PassoLido } from '@/server/reserva-publica/passos';
import type {
  CodigoAviso,
  FaixaDaSemana,
  ItemEscolhido,
  ProfissionalComHorarios,
  ResumoConfirmacao,
  Selecao,
  VisaoDoPasso,
} from '@/server/reserva-publica/tipos';
import { compararDatas, instanteDeHoraLocal, somarDias } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

export const FUSO_DEMO = 'America/Sao_Paulo';
export const JANELA_DEMO = 60;
const ANTECEDENCIA_MS = 2 * 60 * 60_000;
const GRADE_MIN = 15;
const MS_MIN = 60_000;

/** Exemplo do web-design §5: Escova (1 h), Hidratação (40 min) e Manicure (45 min). */
export const SERVICOS_DEMO: readonly ServicoPublico[] = [
  { id: '11111111-1111-4111-8111-111111111111', nome: 'Escova', precoCentavos: 9000, duracaoMin: 60 },
  { id: '22222222-2222-4222-8222-222222222222', nome: 'Hidratação', precoCentavos: 7500, duracaoMin: 40 },
  { id: '33333333-3333-4333-8333-333333333333', nome: 'Manicure', precoCentavos: 4000, duracaoMin: 45 },
];
const [ESCOVA, HIDRATACAO, MANICURE] = SERVICOS_DEMO.map((s) => s.id);

export const EQUIPE_DEMO: readonly ProfissionalPublico[] = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nome: 'Ana' },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nome: 'Bia' },
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', nome: 'Carla' },
];
const [ANA, BIA, CARLA] = EQUIPE_DEMO.map((p) => p.id);

/** Quem faz o quê: Escova (Ana, Bia), Hidratação (as três), Manicure (só Carla). */
const FAZ: Record<string, readonly string[]> = {
  [ANA]: [ESCOVA, HIDRATACAO],
  [BIA]: [ESCOVA, HIDRATACAO],
  [CARLA]: [HIDRATACAO, MANICURE],
};
/** Jornada em minutos do dia local (segunda a sábado; domingo fechado). */
const JORNADA: Record<string, readonly [number, number]> = {
  [ANA]: [540, 1080],
  [BIA]: [600, 960],
  [CARLA]: [480, 1080],
};

export const PERFIL_DEMO: PerfilPublico = {
  nome: 'Studio Bela (demonstração)',
  descricao: 'Cabelo, unhas e estética em um espaço acolhedor no centro da cidade.',
  endereco: { logradouro: 'Rua das Acácias', numero: '120', complemento: 'sala 3', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', cep: '01304001' },
  telefoneE164: '+551134567890',
  whatsappE164: '+5511987654321',
  instagram: 'studiobela',
  meiosPagamento: ['pix', 'cartao_credito', 'dinheiro'],
  comodidades: ['wifi', 'ar_condicionado'],
  funcionamento: montarSemana([1, 2, 3, 4, 5, 6].map((d) => ({ diaSemana: d, inicioMin: 480, fimMin: 1080 }))),
};

export const PERFIL_VAZIO_DEMO: PerfilPublico = {
  nome: 'Salão sem perfil (demonstração)',
  descricao: null,
  endereco: null,
  telefoneE164: null,
  whatsappE164: null,
  instagram: null,
  meiosPagamento: [],
  comodidades: [],
  funcionamento: null,
};

const servicoPorId = (id: string) => SERVICOS_DEMO.find((s) => s.id === id);
const nomeDe = (id: string) => EQUIPE_DEMO.find((p) => p.id === id)?.nome;
const fazOServico = (profissionalId: string, servicoId: string) => FAZ[profissionalId]?.includes(servicoId) ?? false;

export function selecaoDemo(ids: readonly string[]): Selecao | null {
  const servicos = ids.map(servicoPorId);
  if (servicos.some((s) => s === undefined)) return null;
  const lista = servicos as ServicoPublico[];
  return {
    servicos: lista.map(({ id, nome, precoCentavos, duracaoMin }) => ({ id, nome, precoCentavos, duracaoMin })),
    precoTotalCentavos: lista.reduce((t, s) => t + s.precoCentavos, 0),
  };
}

type Ocupacao = { inicio: number; fim: number };

/** Ocupação dos itens escolhidos (a cliente não está em dois lugares ao mesmo tempo, RN-9). */
function ocupacoes(s: readonly string[], itens: readonly (ItemDaUrl | null)[], exceto: number): Ocupacao[] {
  return itens.flatMap((x, k) => {
    if (x === null || k === exceto) return [];
    const inicio = x.inicio.getTime();
    return [{ inicio, fim: inicio + servicoPorId(s[k])!.duracaoMin * MS_MIN }];
  });
}

/** Inícios (UTC, ms) de um profissional para um serviço num dia, descontando as ocupações. */
function horariosDe(profissionalId: string, servicoId: string, data: DataCivil, agora: Date, ocupado: readonly Ocupacao[]): number[] {
  if (diaDaSemana(data) === 0 || !fazOServico(profissionalId, servicoId)) return [];
  const [ini, fim] = JORNADA[profissionalId];
  const duracao = servicoPorId(servicoId)!.duracaoMin;
  const saida: number[] = [];
  for (let m = ini; m + duracao <= fim; m += GRADE_MIN) {
    const t = instanteDeHoraLocal(data, m, FUSO_DEMO).getTime();
    const f = t + duracao * MS_MIN;
    if (t < agora.getTime() + ANTECEDENCIA_MS) continue;
    if (ocupado.some((o) => t < o.fim && f > o.inicio)) continue;
    saida.push(t);
  }
  return saida;
}

/** Profissionais elegíveis (ordem da equipe) com os horários do serviço no dia. */
function profissionaisDoServico(servicoId: string, data: DataCivil, agora: Date, ocupado: readonly Ocupacao[]): ProfissionalComHorarios[] {
  return EQUIPE_DEMO.filter((p) => fazOServico(p.id, servicoId)).map((p) => ({
    id: p.id,
    nome: p.nome,
    horarios: horariosDe(p.id, servicoId, data, agora, ocupado).map((t) => new Date(t).toISOString()),
  }));
}

const oferecido = (ps: readonly ProfissionalComHorarios[], x: ItemDaUrl) =>
  ps.some((p) => p.id === x.profissionalId && p.horarios.includes(x.inicio.toISOString()));

function itemEscolhidoDemo(indice: number, s: readonly string[], x: ItemDaUrl): ItemEscolhido {
  const sv = servicoPorId(s[indice])!;
  return {
    indice,
    servicoId: sv.id,
    servicoNome: sv.nome,
    profissionalId: x.profissionalId,
    profissionalNome: nomeDe(x.profissionalId)!,
    inicioIso: x.inicio.toISOString(),
    fimIso: new Date(x.inicio.getTime() + sv.duracaoMin * MS_MIN).toISOString(),
    precoCentavos: sv.precoCentavos,
    duracaoMin: sv.duracaoMin,
  };
}

const porInicio = (a: ItemEscolhido, b: ItemEscolhido) => (a.inicioIso < b.inicioIso ? -1 : a.inicioIso > b.inicioIso ? 1 : a.indice - b.indice);

/**
 * Régua da semana que começa em `inicio` (já alinhado), com a função real `limitesDaSemana` e a mesma regra
 * DA-2 da página (cada serviço com ao menos um horário no dia, sem os itens escolhidos; D-051 RN-4).
 */
function faixaDemo(s: readonly string[], inicio: DataCivil, hoje: DataCivil, agora: Date, selecionado: DataCivil | null): FaixaDaSemana {
  const semana = limitesDaSemana(inicio, { hoje, janelaDias: JANELA_DEMO });
  const dias: FaixaDaSemana['dias'] = [];
  for (let d = semana.de; compararDatas(d, semana.ate) <= 0; d = somarDias(d, 1)) {
    const temHorarios = s.every((sid) => profissionaisDoServico(sid, d, agora, []).some((p) => p.horarios.length > 0));
    dias.push({ data: chaveDeData(d), temHorarios });
  }
  return {
    hoje: chaveDeData(hoje),
    inicio: chaveDeData(semana.de),
    fim: chaveDeData(semana.ate),
    dias,
    anterior: semana.anterior === null ? null : chaveDeData(semana.anterior),
    proxima: semana.proxima === null ? null : chaveDeData(semana.proxima),
    selecionado: selecionado === null ? null : chaveDeData(selecionado),
  };
}

type EntradaDoServico = {
  s: string[];
  data: DataCivil;
  selecao: Selecao;
  indice: number;
  itens: (ItemDaUrl | null)[];
  atual: ItemDaUrl | null;
  alterando: boolean;
  filtro: string | null;
  aviso: CodigoAviso | null;
  agora: Date;
  /** Hoje no fuso da demonstração (régua do serviço 0). */
  hoje: DataCivil;
};

/** View-model do passo "Serviço k de N", com a mesma forma de `carregarPasso`. */
function visaoDoServico(e: EntradaDoServico): Extract<VisaoDoPasso, { passo: 'servico' }> {
  const sid = e.s[e.indice];
  // Itens de outros serviços inválidos (profissional que não faz o serviço) contam como pendentes.
  const itens = e.itens.map((x, k) => (k === e.indice || (x !== null && fazOServico(x.profissionalId, e.s[k])) ? x : null));
  const todos = profissionaisDoServico(sid, e.data, e.agora, ocupacoes(e.s, itens, e.indice));
  const filtro = e.filtro !== null && todos.some((p) => p.id === e.filtro) ? e.filtro : null;
  const escolhidos: ItemEscolhido[] = [];
  const pendentes: number[] = [];
  itens.forEach((x, k) => {
    if (k === e.indice) return;
    if (x === null) pendentes.push(k);
    else escolhidos.push(itemEscolhidoDemo(k, e.s, x));
  });
  const semHorario = todos.every((p) => p.horarios.length === 0);
  const semNada = semHorario && profissionaisDoServico(sid, e.data, e.agora, []).every((p) => p.horarios.length === 0);
  const atualOferecido = e.atual !== null && oferecido(todos, e.atual);
  const perdeu = e.atual !== null && !atualOferecido;
  return {
    passo: 'servico',
    s: e.s,
    data: chaveDeData(e.data),
    fuso: FUSO_DEMO,
    selecao: e.selecao,
    indice: e.indice,
    total: e.s.length,
    servico: e.selecao.servicos[e.indice],
    escolhidos: escolhidos.sort(porInicio),
    pendentes,
    profissionais: filtro === null ? todos : todos.filter((p) => p.id === filtro),
    opcoesDeFiltro: todos.map(({ id, nome }) => ({ id, nome })),
    filtro,
    preSelecionado: atualOferecido ? valorDoItem(e.atual!.profissionalId, e.atual!.inicio) : null,
    alterando: e.alterando,
    proximoEhDados: pendentes.length === 0,
    vazio: semHorario ? (semNada ? 'calendario' : 'conflito') : null,
    aviso: perdeu ? 'horario_indisponivel' : e.aviso,
    horarioPerdidoIso: perdeu ? e.atual!.inicio.toISOString() : null,
    consulta: { s: e.s, data: chaveDeData(e.data), h: valoresDosItens(itens) },
    faixa:
      e.indice === 0
        ? faixaDemo(e.s, inicioDaSemana(e.data, { hoje: e.hoje, janelaDias: JANELA_DEMO }), e.hoje, e.agora, e.data)
        : null,
  };
}

/** View-model do passo, com a mesma forma de `carregarPasso` (e os mesmos recuos com aviso). */
export function visaoDemonstracao(passo: PassoLido, hoje: DataCivil, agora: Date): VisaoDoPasso {
  if (passo.passo === 'servicos') {
    return { passo: 'servicos', marcados: passo.marcados.filter((id) => servicoPorId(id) !== undefined), aviso: passo.aviso };
  }
  const selecao = selecaoDemo(passo.s);
  if (selecao === null) return { passo: 'servicos', marcados: [], aviso: 'servico_indisponivel' };
  if (passo.passo === 'dia') {
    return {
      passo: 'dia',
      s: passo.s,
      selecao,
      servico: selecao.servicos[0],
      total: passo.s.length,
      faixa: faixaDemo(passo.s, passo.semana, hoje, agora, null),
      aviso: passo.aviso,
    };
  }

  if (passo.passo === 'servico') {
    return visaoDoServico({
      s: passo.s,
      data: passo.data,
      selecao,
      indice: passo.indice,
      itens: passo.itens,
      atual: passo.preSelecionado,
      alterando: passo.alterando,
      filtro: passo.filtro,
      aviso: passo.aviso,
      agora,
      hoje,
    });
  }

  // Dados: o primeiro item que não cabe com os outros volta ao passo dele com aviso.
  const caiu = passo.itens.findIndex(
    (x, k) => !oferecido(profissionaisDoServico(passo.s[k], passo.data, agora, ocupacoes(passo.s, passo.itens, k)), x),
  );
  if (caiu >= 0) {
    const perdido = passo.itens[caiu];
    const v = visaoDoServico({
      s: passo.s,
      data: passo.data,
      selecao,
      indice: caiu,
      itens: passo.itens.map((x, k) => (k === caiu ? null : x)),
      atual: null,
      alterando: false,
      filtro: null,
      aviso: 'horario_indisponivel',
      agora,
      hoje,
    });
    return { ...v, horarioPerdidoIso: perdido.inicio.toISOString() };
  }
  const itens = passo.itens.map((x, k) => itemEscolhidoDemo(k, passo.s, x)).sort(porInicio);
  return {
    passo: 'dados',
    s: passo.s,
    data: chaveDeData(passo.data),
    fuso: FUSO_DEMO,
    selecao,
    itens,
    totalCentavos: itens.reduce((t, i) => t + i.precoCentavos, 0),
    consulta: { s: passo.s, data: chaveDeData(passo.data), h: valoresDosItens(passo.itens) },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Vistas fixas do exemplo (web-design §5.5, §5.6, §5.7): Escova com Ana às 09:00, Hidratação com Bia às 10:00
// e Manicure com Carla às 15:00, no próximo dia útil depois de hoje.

export type VistaDaReserva = 'reescolha' | 'confirmada' | 'conflito' | 'semana-vazia';

/**
 * Vista `semana-vazia` (D-051 CA-12, CA-17): o mesmo passo da query, com todos os dias da régua sem horário
 * (no modelo da `visaoDoConflito`). Só muda o passo `'dia'` e o serviço 0; os demais ficam como vieram.
 */
export function visaoDaSemanaVazia(visao: VisaoDoPasso): VisaoDoPasso {
  const esvaziar = (f: FaixaDaSemana): FaixaDaSemana => ({ ...f, dias: f.dias.map((d) => ({ ...d, temHorarios: false })) });
  if (visao.passo === 'dia') return { ...visao, faixa: esvaziar(visao.faixa) };
  if (visao.passo === 'servico' && visao.faixa !== null) return { ...visao, faixa: esvaziar(visao.faixa) };
  return visao;
}

/** Próximo dia depois de hoje que não é domingo. */
export function diaDoExemplo(hoje: DataCivil): DataCivil {
  const amanha = somarDias(hoje, 1);
  return diaDaSemana(amanha) === 0 ? somarDias(amanha, 1) : amanha;
}

function itensDoExemplo(dia: DataCivil): { s: string[]; itens: ItemDaUrl[] } {
  const em = (min: number) => instanteDeHoraLocal(dia, min, FUSO_DEMO);
  return {
    s: [ESCOVA, HIDRATACAO, MANICURE],
    itens: [
      { profissionalId: ANA, inicio: em(540) },
      { profissionalId: BIA, inicio: em(600) },
      { profissionalId: CARLA, inicio: em(900) },
    ],
  };
}

/** Passo de dados do exemplo completo (base das vistas `reescolha` e `confirmada`). */
export function passoDoExemplo(hoje: DataCivil): PassoLido {
  const dia = diaDoExemplo(hoje);
  return { passo: 'dados', ...itensDoExemplo(dia), data: dia };
}

/**
 * Passo "Serviço 2 de 3" (Hidratação) no estado "vazio por conflito" (§5.7): os horários das profissionais são
 * esvaziados à mão só para mostrar o texto (na disponibilidade real, todos coincidiriam com os já escolhidos).
 */
export function visaoDoConflito(hoje: DataCivil, agora: Date): VisaoDoPasso {
  const dia = diaDoExemplo(hoje);
  const { s, itens } = itensDoExemplo(dia);
  const v = visaoDoServico({
    s,
    data: dia,
    selecao: selecaoDemo(s)!,
    indice: 1,
    itens: [itens[0], null, itens[2]],
    atual: null,
    alterando: false,
    filtro: null,
    aviso: null,
    agora,
    hoje,
  });
  return { ...v, profissionais: v.profissionais.map((p) => ({ ...p, horarios: [] })), vazio: 'conflito' };
}

const VALORES_EXEMPLO: EstadoReserva['valores'] = {
  nome: 'Maria Souza',
  telefone: '(11) 98765-4321',
  mensagensReserva: true,
  conviteAvaliacao: false,
};

/** Estado do formulário para as vistas `reescolha` (Hidratação das 10:00 tomada) e `confirmada`. */
export function estadoDaVista(vista: 'reescolha' | 'confirmada', hoje: DataCivil, agora: Date, chave: string): EstadoReserva {
  const dia = diaDoExemplo(hoje);
  const { s, itens } = itensDoExemplo(dia);
  const escolhidos = itens.map((x, k) => itemEscolhidoDemo(k, s, x)).sort(porInicio);
  const base: EstadoReserva = { status: 'editando', mensagem: null, erros: {}, valores: VALORES_EXEMPLO, chave, resumo: null, repetida: false };
  if (vista === 'confirmada') {
    const resumo: ResumoConfirmacao = {
      fuso: FUSO_DEMO,
      data: chaveDeData(dia),
      itens: escolhidos.map(({ servicoNome, profissionalNome, inicioIso, fimIso, precoCentavos, duracaoMin }) => ({
        servicoNome,
        profissionalNome,
        inicioIso,
        fimIso,
        precoCentavos,
        duracaoMin,
      })),
      totalCentavos: escolhidos.reduce((t, i) => t + i.precoCentavos, 0),
    };
    return { ...base, status: 'confirmada', resumo };
  }
  // Outra cliente levou a Hidratação das 10:00 com a Bia: só a agenda da Bia perde 10:00–10:40.
  const tomado = itens[1];
  const ocupadoBia = { inicio: tomado.inicio.getTime(), fim: tomado.inicio.getTime() + servicoPorId(HIDRATACAO)!.duracaoMin * MS_MIN };
  const duracaoMs = servicoPorId(HIDRATACAO)!.duracaoMin * MS_MIN;
  const alternativas = profissionaisDoServico(HIDRATACAO, dia, agora, ocupacoes(s, itens, 1)).map((p) =>
    p.id !== BIA
      ? p
      : { ...p, horarios: p.horarios.filter((h) => !(Date.parse(h) < ocupadoBia.fim && Date.parse(h) + duracaoMs > ocupadoBia.inicio)) },
  );
  const reescolha: ReescolhaNoEstado = {
    resultado: 'reescolher',
    fuso: FUSO_DEMO,
    data: chaveDeData(dia),
    mantidos: escolhidos.filter((i) => i.indice !== 1),
    itens: [
      {
        indice: 1,
        servicoId: HIDRATACAO,
        servicoNome: 'Hidratação',
        horarioAnteriorIso: tomado.inicio.toISOString(),
        profissionalAnteriorNome: 'Bia',
        profissionais: alternativas,
        caiu: true,
        preSelecionado: null,
      },
    ],
    consulta: { s, data: chaveDeData(dia), h: valoresDosItens(itens) },
  };
  return { ...base, status: 'horario_indisponivel', mensagem: mensagemDaReescolha(reescolha), reescolha };
}
