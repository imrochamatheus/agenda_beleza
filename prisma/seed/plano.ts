// Planejamento puro do seed (D-036): transforma um SalaoSpec e o instante `agora` nas linhas concretas
// com instantes UTC (calculados no fuso do salão por `fuso.ts`, nunca por métodos locais de Date).
// Sem banco, sem relógio: `agora` é entrada. Testado em TZ=UTC e TZ=America/Sao_Paulo.
import { derivarReserva } from '@/server/reservas/itens';
import { instanteDeHoraLocal, partesLocais, somarDias } from '@/server/tempo/fuso';

import { idDemo, type ItemSpec, type ReservaSpec, type SalaoSpec, type StatusSpec } from './dados';

const MIN_MS = 60_000;
const HORA_MS = 60 * MIN_MS;

/** Item planejado (D-050): a unidade de agenda, com profissional, horário e status próprios. */
export type ItemPlanejado = {
  id: string;
  servicoId: string;
  profissionalId: string;
  ordem: number;
  inicio: Date;
  fim: Date;
  ocupadoAte: Date;
  status: StatusSpec;
  precoCentavos: number;
  duracaoMin: number;
};

/** Reserva planejada: `status`, `inicio`, `fim` e `canceladaEm` DERIVADOS dos itens por `derivarReserva` (D-050 A-1/A-2). */
export type ReservaPlanejada = {
  id: string;
  chave: string;
  clienteId: string;
  inicio: Date;
  fim: Date;
  status: StatusSpec;
  canceladaEm: Date | null;
  itens: ItemPlanejado[];
};

export type AvaliacaoPlanejada = {
  id: string;
  reservaId: string;
  clienteId: string;
  nota: number;
  comentario: string | null;
  nomeExibicao: string | null;
  criadoEm: Date;
};

export type BloqueioPlanejado = { id: string; profissionalId: string | null; inicio: Date; fim: Date; motivo: string };

export type PlanoDoSalao = {
  reservas: ReservaPlanejada[];
  avaliacoes: AvaliacaoPlanejada[];
  bloqueios: BloqueioPlanejado[];
};

export function ids(spec: SalaoSpec) {
  const e = spec.chave;
  return {
    salao: idDemo(e, 'salao'),
    gestor: idDemo(e, 'usuario:gestor'),
    profissional: (c: string) => idDemo(e, `profissional:${c}`),
    usuarioProfissional: (c: string) => idDemo(e, `usuario:${c}`),
    servico: (c: string) => idDemo(e, `servico:${c}`),
    cliente: (c: string) => idDemo(e, `cliente:${c}`),
    reserva: (c: string) => idDemo(e, `reserva:${c}`),
    item: (r: string, ordem: number) => idDemo(e, `item:${r}:${ordem}`),
    avaliacao: (r: string) => idDemo(e, `avaliacao:${r}`),
    bloqueio: (c: string) => idDemo(e, `bloqueio:${c}`),
    foto: (n: number) => idDemo(e, `foto:${n}`),
    envioFoto: (n: number) => idDemo(e, `envio:${n}`),
    assinatura: idDemo(e, 'assinatura'),
    jornada: (p: string, dia: number, i: number) => idDemo(e, `jornada:${p}:${dia}:${i}`),
    funcionamento: (dia: number, i: number) => idDemo(e, `funcionamento:${dia}:${i}`),
    consentimento: (c: string, finalidade: string) => idDemo(e, `consentimento:${c}:${finalidade}`),
  };
}

export function planejar(spec: SalaoSpec, agora: Date): PlanoDoSalao {
  const id = ids(spec);
  const hoje = partesLocais(agora, spec.fuso).data;
  const servicos = new Map(spec.servicos.map((s) => [s.chave, s]));

  const reservas: ReservaPlanejada[] = spec.reservas.map((r) => {
    const dia = somarDias(hoje, r.dia);
    let anterior: ItemPlanejado | null = null;
    const itens = itensDaSpec(r).map((it, ordem): ItemPlanejado => {
      const s = servicos.get(it.servico);
      if (!s) throw new Error(`serviço desconhecido no seed: ${it.servico}`);
      const profissionalId = id.profissional(it.profissional);
      // Sem `inicioMin`: encadeado ao item anterior, depois do intervalo do salão (RN-9 quando é o mesmo profissional).
      let inicio: Date;
      if (it.inicioMin !== undefined) inicio = instanteDeHoraLocal(dia, it.inicioMin, spec.fuso);
      else if (anterior !== null) inicio = anterior.ocupadoAte;
      else throw new Error(`primeiro item sem horário no seed: ${r.chave}`);
      const fim = new Date(inicio.getTime() + s.duracaoMin * MIN_MS);
      const item: ItemPlanejado = {
        id: id.item(r.chave, ordem),
        servicoId: id.servico(it.servico),
        profissionalId,
        ordem,
        inicio,
        fim,
        // Mesma regra da criação (D-050 §3.5 passo 5): cada item ocupa até fim + intervalo do salão.
        ocupadoAte: new Date(fim.getTime() + spec.intervaloMin * MIN_MS),
        status: it.status ?? r.status,
        precoCentavos: s.precoCentavos,
        duracaoMin: s.duracaoMin,
      };
      anterior = item;
      return item;
    });
    // O cancelamento aconteceu 1 dia antes do primeiro item, nunca depois do início (coerente em passado e futuro).
    const primeiro = Math.min(...itens.map((i) => i.inicio.getTime()));
    const derivados = derivarReserva(itens, null, new Date(primeiro - 24 * HORA_MS));
    return {
      id: id.reserva(r.chave),
      chave: r.chave,
      clienteId: id.cliente(r.cliente),
      inicio: derivados.inicio,
      fim: derivados.fim,
      status: derivados.status as StatusSpec,
      canceladaEm: derivados.canceladaEm,
      itens,
    };
  });

  const porChave = new Map(reservas.map((r) => [r.chave, r]));
  const avaliacoes: AvaliacaoPlanejada[] = spec.avaliacoes.map((a) => {
    const r = porChave.get(a.reserva);
    if (!r || r.status !== 'concluido') throw new Error(`avaliação só de reserva concluída: ${a.reserva}`);
    return {
      id: id.avaliacao(a.reserva),
      reservaId: r.id,
      clienteId: r.clienteId,
      nota: a.nota,
      comentario: a.comentario ?? null,
      nomeExibicao: a.nomeExibicao ?? null,
      criadoEm: new Date(r.fim.getTime() + 2 * HORA_MS),
    };
  });

  const bloqueios: BloqueioPlanejado[] = spec.bloqueios.map((b) => {
    const dia = somarDias(hoje, b.dia);
    return {
      id: id.bloqueio(b.chave),
      profissionalId: b.profissional === undefined ? null : id.profissional(b.profissional),
      inicio: instanteDeHoraLocal(dia, b.inicioMin, spec.fuso),
      fim: instanteDeHoraLocal(dia, b.fimMin, spec.fuso),
      motivo: b.motivo,
    };
  });

  return { reservas, avaliacoes, bloqueios };
}

/** Os itens da spec: a forma explícita (`itens`) ou a abreviada (um profissional, serviços encadeados). */
function itensDaSpec(r: ReservaSpec): readonly ItemSpec[] {
  if ('itens' in r) return r.itens;
  return r.servicos.map((servico, k) => ({ servico, profissional: r.profissional, inicioMin: k === 0 ? r.inicioMin : undefined }));
}

/**
 * Pares de itens ocupantes do mesmo profissional cujos `[inicio, ocupadoAte)` se cruzam, inclusive entre
 * reservas diferentes (o que `reserva_item_sem_sobreposicao` recusaria). Cada item é `<chave>:<ordem>`.
 */
export function sobreposicoes(reservas: readonly ReservaPlanejada[]): [string, string][] {
  const ocupantes = reservas.flatMap((r) => r.itens.filter((i) => i.status !== 'cancelado').map((i) => ({ rotulo: `${r.chave}:${i.ordem}`, i })));
  const pares: [string, string][] = [];
  for (let x = 0; x < ocupantes.length; x += 1) {
    for (let y = x + 1; y < ocupantes.length; y += 1) {
      const a = ocupantes[x]!;
      const b = ocupantes[y]!;
      if (a.i.profissionalId === b.i.profissionalId && a.i.inicio < b.i.ocupadoAte && b.i.inicio < a.i.ocupadoAte) {
        pares.push([a.rotulo, b.rotulo]);
      }
    }
  }
  return pares;
}
