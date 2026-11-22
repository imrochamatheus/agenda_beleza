import type { EstadoAssinatura } from '@/domain/assinatura';
import {
  MAX_EVENTOS,
  lerResumo,
  lerSalaoDaAssinatura,
  listarEventos,
  listarTransicoes,
} from '@/server/repos/admin-assinatura';
import { ehUuid } from '@/server/repos/ids';
import { exigirAdmin } from '@/server/tenant/context';
import type { AdminContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { CODIGOS_ERRO_WEBHOOK, MAX_CAUSA } from './assinatura-tipos';
import type { AssinaturaDoSalaoDTO } from './assinatura-tipos';

// Assinatura, transições e eventos de webhook de um salão para o super admin (D-045 RN-10/11/14). Só leitura
// (nenhuma auditoria, RN-3). Sem next/*, sem Prisma. Salão malformado ou inexistente → NaoEncontrado.

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** Trunca por pontos de código (não parte emoji ao meio). */
export function truncarCausa(causa: string): string {
  const pontos = Array.from(causa);
  return pontos.length <= MAX_CAUSA ? causa : `${pontos.slice(0, MAX_CAUSA).join('')}…`;
}

export async function lerAssinaturaDoSalao(ctx: AdminContext, salaoId: unknown): Promise<AssinaturaDoSalaoDTO> {
  exigirAdmin(ctx);
  if (!ehUuid(salaoId)) throw new NaoEncontrado();
  const salao = await lerSalaoDaAssinatura(salaoId);
  if (salao === null) throw new NaoEncontrado();
  const [resumo, transicoes, eventos] = await Promise.all([lerResumo(salaoId), listarTransicoes(salaoId), listarEventos(salaoId)]);
  return {
    salao,
    assinatura:
      resumo === null
        ? null
        : {
            estado: resumo.estado as EstadoAssinatura,
            vinculada: resumo.vinculada,
            testeFimEm: iso(resumo.testeFimEm),
            periodoPagoAte: iso(resumo.periodoPagoAte),
            primeiraFalhaEm: iso(resumo.primeiraFalhaEm),
            carenciaAte: iso(resumo.carenciaAte),
            canceladaEm: iso(resumo.canceladaEm),
            acessoAte: iso(resumo.acessoAte),
          },
    transicoes: transicoes.map((t) => ({
      id: t.id,
      de: t.de as EstadoAssinatura | null,
      para: t.para as EstadoAssinatura,
      causa: truncarCausa(t.causa),
      ocorridaEm: t.ocorridaEm.toISOString(),
      origemEvento: t.origemEvento,
    })),
    eventos: eventos.slice(0, MAX_EVENTOS).map((e) => ({
      id: e.id,
      tipo: e.tipo,
      resultado: e.resultado,
      origemValida: e.origemValida,
      erro: e.erro !== null && CODIGOS_ERRO_WEBHOOK.includes(e.erro) ? e.erro : null,
      recebidoEm: e.recebidoEm.toISOString(),
      processadoEm: iso(e.processadoEm),
      payload: e.payload,
    })),
    maisEventos: eventos.length > MAX_EVENTOS,
  };
}
