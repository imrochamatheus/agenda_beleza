// Planejamento puro do seed (D-036): transforma um SalaoSpec e o instante `agora` nas linhas concretas
// com instantes UTC (calculados no fuso do salão por `fuso.ts`, nunca por métodos locais de Date).
// Sem banco, sem relógio: `agora` é entrada. Testado em TZ=UTC e TZ=America/Sao_Paulo.
import { instanteDeHoraLocal, partesLocais, somarDias } from '@/server/tempo/fuso';

import { idDemo, type SalaoSpec, type StatusSpec } from './dados';

const MIN_MS = 60_000;
const HORA_MS = 60 * MIN_MS;

export type ReservaPlanejada = {
  id: string;
  chave: string;
  profissionalId: string;
  clienteId: string;
  inicio: Date;
  fim: Date;
  ocupadoAte: Date;
  status: StatusSpec;
  canceladaEm: Date | null;
  itens: { id: string; servicoId: string; ordem: number; precoCentavos: number; duracaoMin: number }[];
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
    const inicio = instanteDeHoraLocal(somarDias(hoje, r.dia), r.inicioMin, spec.fuso);
    let cursor = inicio.getTime();
    const itens = r.servicos.map((chave, ordem) => {
      const s = servicos.get(chave);
      if (!s) throw new Error(`serviço desconhecido no seed: ${chave}`);
      cursor += s.duracaoMin * MIN_MS;
      return { id: id.item(r.chave, ordem), servicoId: id.servico(chave), ordem, precoCentavos: s.precoCentavos, duracaoMin: s.duracaoMin };
    });
    const fim = new Date(cursor);
    return {
      id: id.reserva(r.chave),
      chave: r.chave,
      profissionalId: id.profissional(r.profissional),
      clienteId: id.cliente(r.cliente),
      inicio,
      fim,
      ocupadoAte: new Date(cursor + spec.intervaloMin * MIN_MS),
      status: r.status,
      // O cancelamento aconteceu 1 dia antes do horário, nunca depois do início (coerente em passado e futuro).
      canceladaEm: r.status === 'cancelado' ? new Date(inicio.getTime() - 24 * HORA_MS) : null,
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

/** Pares de reservas ocupantes do mesmo profissional cujos intervalos [inicio, ocupadoAte) se cruzam. */
export function sobreposicoes(reservas: readonly ReservaPlanejada[]): [string, string][] {
  const ocupantes = reservas.filter((r) => r.status !== 'cancelado');
  const pares: [string, string][] = [];
  for (let i = 0; i < ocupantes.length; i += 1) {
    for (let j = i + 1; j < ocupantes.length; j += 1) {
      const a = ocupantes[i]!;
      const b = ocupantes[j]!;
      if (a.profissionalId === b.profissionalId && a.inicio < b.ocupadoAte && b.inicio < a.ocupadoAte) {
        pares.push([a.chave, b.chave]);
      }
    }
  }
  return pares;
}
