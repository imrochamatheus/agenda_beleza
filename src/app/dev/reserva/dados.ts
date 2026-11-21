// Dados em memória da vitrine /dev/reserva (D-026 §8, CA-12): o MESMO fluxo da página pública, sem banco.
// A derivação do passo e a validação são as funções puras reais (`lerPasso`, validações da reserva); só a
// disponibilidade é fabricada aqui (grade fixa), em horário de parede de São Paulo.
import { diaDaSemana } from '@/domain/disponibilidade';
import { montarSemana } from '@/server/semana/montagem';
import type { PerfilPublico, ProfissionalPublico, ServicoPublico } from '@/server/repos/publico';
import { chaveDeData, DIAS_POR_PAGINA, QUALQUER } from '@/server/reserva-publica/passos';
import type { PassoLido } from '@/server/reserva-publica/passos';
import type { Selecao, VisaoDoPasso } from '@/server/reserva-publica/tipos';
import { compararDatas, instanteDeHoraLocal, somarDias } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

export const FUSO_DEMO = 'America/Sao_Paulo';
export const JANELA_DEMO = 60;
const ANTECEDENCIA_MS = 2 * 60 * 60_000;

export const SERVICOS_DEMO: readonly ServicoPublico[] = [
  { id: '11111111-1111-4111-8111-111111111111', nome: 'Corte feminino', precoCentavos: 9000, duracaoMin: 60 },
  { id: '22222222-2222-4222-8222-222222222222', nome: 'Escova', precoCentavos: 5500, duracaoMin: 30 },
  { id: '33333333-3333-4333-8333-333333333333', nome: 'Coloração', precoCentavos: 18000, duracaoMin: 120 },
];
const [CORTE, ESCOVA, COLORACAO] = SERVICOS_DEMO.map((s) => s.id);

export const EQUIPE_DEMO: readonly ProfissionalPublico[] = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nome: 'Ana' },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nome: 'Bia' },
];
const FAZ: Record<string, readonly string[]> = {
  [EQUIPE_DEMO[0].id]: [CORTE, ESCOVA, COLORACAO],
  [EQUIPE_DEMO[1].id]: [CORTE, ESCOVA],
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
  funcionamento: montarSemana([1, 2, 3, 4, 5, 6].map((d) => ({ diaSemana: d, inicioMin: 540, fimMin: d === 6 ? 840 : 1080 }))),
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

function elegiveis(ids: readonly string[]): ProfissionalPublico[] {
  return EQUIPE_DEMO.filter((p) => ids.every((id) => FAZ[p.id].includes(id)));
}

export function selecaoDemo(ids: readonly string[]): Selecao | null {
  const servicos = ids.map((id) => SERVICOS_DEMO.find((s) => s.id === id));
  if (servicos.some((s) => s === undefined)) return null;
  const lista = servicos as ServicoPublico[];
  return {
    servicos: lista,
    duracaoTotalMin: lista.reduce((t, s) => t + s.duracaoMin, 0),
    precoTotalCentavos: lista.reduce((t, s) => t + s.precoCentavos, 0),
  };
}

/** Horários (UTC) de um profissional num dia: domingo fechado; grade de 30 min; antecedência de 2 h. */
function horariosDoDia(profissionalId: string, data: DataCivil, duracaoMin: number, agora: Date): { t: number; id: string; nome: string }[] {
  if (diaDaSemana(data) === 0) return [];
  const [inicio, fim] = profissionalId === EQUIPE_DEMO[0].id ? [540, 1080] : [600, 960];
  const nome = EQUIPE_DEMO.find((p) => p.id === profissionalId)!.nome;
  const saida: { t: number; id: string; nome: string }[] = [];
  for (let m = inicio; m + duracaoMin <= fim; m += 30) {
    const t = instanteDeHoraLocal(data, m, FUSO_DEMO).getTime();
    if (t >= agora.getTime() + ANTECEDENCIA_MS) saida.push({ t, id: profissionalId, nome });
  }
  return saida;
}

/** União por instante; o primeiro profissional em ordem de nome leva o horário. */
function horariosUnidos(passoP: string, ids: readonly string[], data: DataCivil, duracaoMin: number, agora: Date) {
  const candidatos = passoP === QUALQUER ? elegiveis(ids) : elegiveis(ids).filter((p) => p.id === passoP);
  const mapa = new Map<number, { id: string; nome: string }>();
  for (const p of candidatos) {
    for (const h of horariosDoDia(p.id, data, duracaoMin, agora)) if (!mapa.has(h.t)) mapa.set(h.t, { id: h.id, nome: h.nome });
  }
  return mapa;
}

/** View-model do passo, com a mesma forma de `carregarPasso` (e os mesmos recuos com aviso). */
export function visaoDemonstracao(passo: PassoLido, hoje: DataCivil, agora: Date): VisaoDoPasso {
  if (passo.passo === 'servicos') return { passo: 'servicos', aviso: passo.aviso };
  const selecao = selecaoDemo(passo.s);
  if (selecao === null) return { passo: 'servicos', aviso: 'servico_indisponivel' };
  const profissionais = elegiveis(passo.s);
  if (profissionais.length === 0) return { passo: 'servicos', aviso: 'sem_profissional' };
  if (passo.passo === 'profissional') return { passo: 'profissional', s: passo.s, selecao, profissionais, aviso: passo.aviso };
  if (passo.p !== QUALQUER && !profissionais.some((p) => p.id === passo.p)) {
    return { passo: 'profissional', s: passo.s, selecao, profissionais, aviso: 'profissional_indisponivel' };
  }
  const ultima = somarDias(hoje, JANELA_DEMO);

  if (passo.passo === 'data') {
    const fim = somarDias(passo.de, DIAS_POR_PAGINA - 1);
    const ate = compararDatas(fim, ultima) > 0 ? ultima : fim;
    const dias: { data: string; temHorarios: boolean }[] = [];
    for (let d = passo.de; compararDatas(d, ate) <= 0; d = somarDias(d, 1)) {
      dias.push({ data: chaveDeData(d), temHorarios: horariosUnidos(passo.p, passo.s, d, selecao.duracaoTotalMin, agora).size > 0 });
    }
    const anterior = somarDias(passo.de, -DIAS_POR_PAGINA);
    const proxima = somarDias(passo.de, DIAS_POR_PAGINA);
    return {
      passo: 'data',
      s: passo.s,
      p: passo.p,
      selecao,
      de: chaveDeData(passo.de),
      dias,
      anterior: compararDatas(passo.de, hoje) > 0 ? chaveDeData(compararDatas(anterior, hoje) < 0 ? hoje : anterior) : null,
      proxima: compararDatas(proxima, ultima) <= 0 ? chaveDeData(proxima) : null,
      aviso: passo.aviso,
    };
  }

  const doDia = horariosUnidos(passo.p, passo.s, passo.data, selecao.duracaoTotalMin, agora);
  const horarios = [...doDia.keys()].sort((a, b) => a - b).map((t) => new Date(t).toISOString());
  const base = { s: passo.s, p: passo.p, data: chaveDeData(passo.data), selecao, fuso: FUSO_DEMO };
  if (passo.passo === 'horario') return { passo: 'horario', ...base, horarios, aviso: passo.aviso };
  const escolhido = doDia.get(passo.h.getTime());
  if (escolhido === undefined) return { passo: 'horario', ...base, horarios, aviso: 'horario_indisponivel' };
  return { passo: 'dados', ...base, inicioIso: passo.h.toISOString(), profissional: escolhido };
}
