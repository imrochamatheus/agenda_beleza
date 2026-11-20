import { criarPublicoContext, exigirPublico } from '@/server/tenant/context';
import type { PublicoContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { COMODIDADES, filtrarChaves, MEIOS_PAGAMENTO } from '@/server/salao/perfil-tipos';
import type { ChaveComodidade, ChaveMeioPagamento } from '@/server/salao/perfil-tipos';
import { montarSemana } from '@/server/semana/montagem';
import type { SemanaHoraria } from '@/server/semana/tipos';

import { obterPrisma } from './db';
import { COLUNAS_FUNCIONAMENTO, funcionamentoDaLinha } from './funcionamento';
import type { ColunasFuncionamento } from './funcionamento';
import type { FuncionamentoDTO } from './tipos';

/**
 * Leituras da página pública (RN-3, CA-12). Só campos públicos, por `select` explícito: nunca e-mail,
 * usuario_id, dados de cliente ou de reserva. Só serviços e profissionais ATIVOS (RN-16).
 */
export type ResolucaoSlug = { contexto: PublicoContext; slugAtual: string; historico: boolean };
export type ServicoPublico = { id: string; nome: string; precoCentavos: number; duracaoMin: number };
export type ProfissionalPublico = { id: string; nome: string };

/**
 * Resolve o salão pelo slug (atual ou histórico), por comparação exata (a normalização é da
 * E1.1/E4.1). Inexistente → NaoEncontrado. `historico` indica slug antigo; o redirecionamento 301
 * para `slugAtual` é da E4.1.
 */
export async function resolverSalaoPorSlug(slug: string): Promise<ResolucaoSlug> {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new NaoEncontrado();
  }
  const prisma = obterPrisma();
  const registro = await prisma.salaoSlug.findUnique({
    where: { slug },
    select: { salaoId: true, atual: true },
  });
  if (!registro) {
    throw new NaoEncontrado();
  }
  const atual = registro.atual
    ? { slug }
    : await prisma.salaoSlug.findFirst({
        where: { salaoId: registro.salaoId, atual: true },
        select: { slug: true },
      });
  if (!atual) {
    throw new NaoEncontrado();
  }
  return {
    contexto: criarPublicoContext(registro.salaoId, atual.slug),
    slugAtual: atual.slug,
    historico: !registro.atual,
  };
}

/**
 * Serviços ofertáveis do salão (D-014 RN-7): ativos E com ao menos um profissional ATIVO vinculado
 * (a relação é pela FK composta (salao_id, profissional_id): só enxerga profissionais do mesmo salão).
 * É a ÚNICA leitura de serviços ofertáveis para E3.1 (disponibilidade) e E4.1 (página pública).
 */
export async function listarServicosPublicos(ctx: PublicoContext): Promise<ServicoPublico[]> {
  const salaoId = exigirPublico(ctx);
  return obterPrisma().servico.findMany({
    where: { salaoId, ativo: true, profissionais: { some: { profissional: { ativo: true } } } },
    select: { id: true, nome: true, precoCentavos: true, duracaoMin: true },
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
  });
}

export async function listarProfissionaisPublicos(
  ctx: PublicoContext,
): Promise<ProfissionalPublico[]> {
  const salaoId = exigirPublico(ctx);
  return obterPrisma().profissional.findMany({
    where: { salaoId, ativo: true },
    select: { id: true, nome: true },
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
  });
}

/** Endereço público (D-020 RN-18): completo ou null. */
export type EnderecoPublico = {
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
};

/**
 * Perfil público do salão (D-020 RN-18, projeção mínima). Nunca suspensão, regras de horário, ids de
 * usuário, e-mails, atualizado_em nem assinatura. `funcionamento` null = não informado.
 */
export type PerfilPublico = {
  nome: string;
  descricao: string | null;
  endereco: EnderecoPublico | null;
  telefoneE164: string | null;
  whatsappE164: string | null;
  instagram: string | null;
  meiosPagamento: ChaveMeioPagamento[];
  comodidades: ChaveComodidade[];
  funcionamento: SemanaHoraria | null;
};

type LinhaPerfilPublico = ColunasFuncionamento & {
  nome: string;
  descricao: string | null;
  endereco_logradouro: string | null;
  endereco_numero: string | null;
  endereco_complemento: string | null;
  endereco_bairro: string | null;
  endereco_cidade: string | null;
  endereco_uf: string | null;
  endereco_cep: string | null;
  telefone_e164: string | null;
  whatsapp_e164: string | null;
  instagram: string | null;
  meios_pagamento: string[];
  comodidades: string[];
};

function enderecoPublico(l: LinhaPerfilPublico): EnderecoPublico | null {
  const { endereco_logradouro: logradouro, endereco_numero: numero, endereco_bairro: bairro } = l;
  const { endereco_cidade: cidade, endereco_uf: uf, endereco_cep: cep } = l;
  if (logradouro === null || numero === null || bairro === null || cidade === null || uf === null || cep === null) {
    return null;
  }
  return { logradouro, numero, complemento: l.endereco_complemento, bairro, cidade, uf, cep };
}

/**
 * Perfil público do salão (D-020 RN-18; E4.1): um comando, colunas explícitas e o fragmento único do
 * funcionamento. Sem linha → NaoEncontrado. NÃO filtra suspensão (PLAN: o perfil continua visível).
 * Listas só com chaves conhecidas, na ordem da lista; endereço null se algum obrigatório faltar.
 */
export async function lerPerfilPublico(ctx: PublicoContext): Promise<PerfilPublico> {
  const salaoId = exigirPublico(ctx);
  const linhas = await obterPrisma().$queryRaw<LinhaPerfilPublico[]>`
    SELECT s.nome, s.descricao, s.endereco_logradouro, s.endereco_numero, s.endereco_complemento,
           s.endereco_bairro, s.endereco_cidade, s.endereco_uf, s.endereco_cep, s.telefone_e164,
           s.whatsapp_e164, s.instagram, s.meios_pagamento, s.comodidades, ${COLUNAS_FUNCIONAMENTO}
      FROM salao s
     WHERE s.id = ${salaoId}::uuid`;
  const l = linhas[0];
  if (!l) {
    throw new NaoEncontrado();
  }
  const funcionamento = funcionamentoDaLinha(l);
  return {
    nome: l.nome,
    descricao: l.descricao,
    endereco: enderecoPublico(l),
    telefoneE164: l.telefone_e164,
    whatsappE164: l.whatsapp_e164,
    instagram: l.instagram,
    meiosPagamento: filtrarChaves(MEIOS_PAGAMENTO, l.meios_pagamento),
    comodidades: filtrarChaves(COMODIDADES, l.comodidades),
    funcionamento: funcionamento.definido ? montarSemana(funcionamento.linhas) : null,
  };
}

/** Só o funcionamento, com o mesmo fragmento (leitura sem papel com contexto público, D-020 A-6). */
export async function lerFuncionamentoPublico(ctx: PublicoContext): Promise<FuncionamentoDTO> {
  const salaoId = exigirPublico(ctx);
  const linhas = await obterPrisma().$queryRaw<ColunasFuncionamento[]>`
    SELECT ${COLUNAS_FUNCIONAMENTO} FROM salao s WHERE s.id = ${salaoId}::uuid`;
  const l = linhas[0];
  if (!l) {
    throw new NaoEncontrado();
  }
  return funcionamentoDaLinha(l);
}
