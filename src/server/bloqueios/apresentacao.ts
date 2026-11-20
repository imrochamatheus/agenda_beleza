import { formatarData, formatarDataHora, formatarHora, formatarPeriodoBloqueio } from '@/lib/format';
import { ROTULO_CLIENTE_REMOVIDA } from '@/server/profissionais/tipos';
import type { BloqueioDTO, ProfissionalAlvoDTO, ReservaCobertaDTO } from '@/server/repos/tipos';
import type { PapelDeSalao } from '@/server/tenant/context';
import { ehDiaInteiro } from '@/server/tempo/fuso';

import { ALVO_SALAO, MENSAGENS_BLOQUEIO } from './tipos';
import type { AvisoReservas, BloqueioItem, OpcaoAlvo, ValoresBloqueio } from './tipos';

// Apresentação dos bloqueios (D-016 §3.4): DTO → item de lista, aviso e valores de edição, já com os
// textos de data/hora no fuso do salão (RN-19; só por src/lib/format.ts). Pura: sem banco nem next/*.

/** Item da lista. Gestor edita todos; profissional, só os próprios (os do salão são somente leitura, D-10). */
export function paraItem(
  dto: BloqueioDTO,
  fuso: string,
  ctx: { papel: PapelDeSalao; profissionalId: string | null },
): BloqueioItem {
  const diaInteiro = ehDiaInteiro(dto.inicio, dto.fim, fuso);
  const alvo: BloqueioItem['alvo'] =
    dto.profissionalId === null
      ? { tipo: 'salao' }
      : {
          tipo: 'profissional',
          id: dto.profissionalId,
          nome: dto.profissional?.nome ?? '',
          ativo: dto.profissional?.ativo ?? true,
        };
  const editavel =
    ctx.papel === 'gestor' || (dto.profissionalId !== null && ctx.profissionalId !== null && dto.profissionalId === ctx.profissionalId);
  return {
    id: dto.id,
    alvo,
    inicio: dto.inicio.toISOString(),
    fim: dto.fim.toISOString(),
    diaInteiro,
    periodo: formatarPeriodoBloqueio(dto.inicio, dto.fim, fuso, diaInteiro),
    motivo: dto.motivo,
    editavel,
  };
}

/** Aviso de reservas cobertas (RN-8): horários no fuso; cliente anonimizada → "cliente removida". */
export function paraAviso(r: { reservas: ReservaCobertaDTO[]; total: number }, fuso: string): AvisoReservas {
  return {
    total: r.total,
    reservas: r.reservas.map((x) => ({
      id: x.id,
      profissionalNome: x.profissionalNome,
      inicioLocal: formatarDataHora(x.inicio, fuso),
      fimLocal: formatarDataHora(x.fim, fuso),
      cliente: x.clienteNome ?? ROTULO_CLIENTE_REMOVIDA,
    })),
  };
}

/**
 * Valores do formulário de edição: dia inteiro → modo dia_inteiro, dataFim = data de `fim − 1 ms` (a
 * última data inclusiva, também nos dias de 23/25 h), horas vazias; senão modo horario com data e hora
 * nas duas pontas. O alvo não é editável (RN-11): vai só como referência.
 */
export function valoresDeEdicao(dto: BloqueioDTO, fuso: string): ValoresBloqueio {
  const alvo = dto.profissionalId ?? ALVO_SALAO;
  const motivo = dto.motivo ?? '';
  if (ehDiaInteiro(dto.inicio, dto.fim, fuso)) {
    return {
      alvo,
      modo: 'dia_inteiro',
      dataInicio: formatarData(dto.inicio, fuso),
      horaInicio: '',
      dataFim: formatarData(new Date(dto.fim.getTime() - 1), fuso),
      horaFim: '',
      motivo,
    };
  }
  return {
    alvo,
    modo: 'horario',
    dataInicio: formatarData(dto.inicio, fuso),
    horaInicio: formatarHora(dto.inicio, fuso),
    dataFim: formatarData(dto.fim, fuso),
    horaFim: formatarHora(dto.fim, fuso),
    motivo,
  };
}

/** Opções do alvo para o gestor: "Salão inteiro" primeiro, depois os profissionais (inativos marcados). */
export function opcoesDeAlvo(profissionais: readonly ProfissionalAlvoDTO[]): OpcaoAlvo[] {
  return [
    { valor: ALVO_SALAO, rotulo: MENSAGENS_BLOQUEIO.salaoInteiro },
    ...profissionais.map((p) => ({ valor: p.id, rotulo: p.ativo ? p.nome : `${p.nome} ${MENSAGENS_BLOQUEIO.inativo}` })),
  ];
}
