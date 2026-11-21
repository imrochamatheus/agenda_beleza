// Reescolha do horário depois de um conflito (D-036 DEF-1). Sem next/*. Quando o horário escolhido é tomado
// entre a escolha e o envio, a ação devolve, NA RESPOSTA, os horários atualizados do mesmo dia; nome, telefone e
// aceites ficam no estado do formulário (nunca na URL: PII). Reaproveita `lerPasso` e `carregarPassoComLimite`,
// sem segunda implementação de disponibilidade.
import { resolverSalaoPorSlug } from '@/server/repos/publico';
import { listarServicosPublicos } from '@/server/repos/publico';
import { NaoEncontrado } from '@/server/tenant/erros';

import { carregarPassoComLimite, lerRegrasDaPagina } from './pagina';
import { lerPasso, slugPlausivel } from './passos';
import type { ParametrosBrutos } from './passos';
import type { VisaoDoPasso } from './tipos';

async function visaoDaConsulta(slug: string, consulta: ParametrosBrutos, agora: Date, ip: string): Promise<VisaoDoPasso | null> {
  if (!slugPlausivel(slug)) return null;
  let resolucao;
  try {
    resolucao = await resolverSalaoPorSlug(slug);
  } catch (e) {
    if (e instanceof NaoEncontrado) return null;
    throw e;
  }
  if (resolucao.historico) return null;
  const ctx = resolucao.contexto;
  const [servicos, regras] = await Promise.all([listarServicosPublicos(ctx), lerRegrasDaPagina(ctx, agora)]);
  return carregarPassoComLimite(ctx, lerPasso(consulta, regras), { servicos, regras, agora, ip });
}

/** Horários atualizados do dia (ISO UTC) e o fuso; null se a seleção não leva mais a um passo de horário. */
export async function horariosParaReescolha(
  slug: string,
  consulta: { s: string[]; p: string; data: string },
  agora: Date,
  ip: string,
): Promise<{ fuso: string; horarios: string[] } | null> {
  const v = await visaoDaConsulta(slug, consulta, agora, ip);
  return v !== null && v.passo === 'horario' ? { fuso: v.fuso, horarios: v.horarios } : null;
}

/** Profissional que atende no horário escolhido (resolve "Sem preferência"); null se o horário não existe mais. */
export async function profissionalDoHorario(
  slug: string,
  consulta: { s: string[]; p: string; data: string; h: string },
  agora: Date,
  ip: string,
): Promise<string | null> {
  const v = await visaoDaConsulta(slug, consulta, agora, ip);
  return v !== null && v.passo === 'dados' ? v.profissional.id : null;
}
