import { exigirPermissao } from '@/server/auth/permissoes';
import { repos } from '@/server/repos';
import type { Repos } from '@/server/repos';
import type { ServicoPainelDTO } from '@/server/repos/tipos';
import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { MENSAGENS_SERVICO } from './tipos';
import type {
  ProfissionalOpcao,
  ResultadoSalvarServico,
  ResultadoSituacaoServico,
  ServicoEdicao,
  ServicoResumo,
} from './tipos';
import { validarDadosServico } from './validacao';
import type { DadosServicoValidos } from './validacao';

// Serviço de domínio da gestão de serviços (D-014 §3.5; RN-1..RN-13). Sem next/*: as ações
// (servicos.acao.ts) e as páginas o chamam. Toda função confere a matriz de permissões (defesa em
// profundidade, além de `papeis: ['gestor']` na ação) e só usa o salão do contexto. Transações na
// ordem canônica de travas (repos/servico.ts): profissionais FOR SHARE → serviço → vínculos.

/** Log estruturado de uma linha, só ids e contagens (sem nomes). */
function registrar(evento: string, dados: Record<string, unknown>): void {
  console.info(JSON.stringify({ evento, ...dados }));
}

function resumo(s: ServicoPainelDTO): ServicoResumo {
  return {
    id: s.id,
    nome: s.nome,
    precoCentavos: s.precoCentavos,
    duracaoMin: s.duracaoMin,
    ativo: s.ativo,
    profissionaisAtivos: s.profissionaisAtivos,
    ofertavel: s.ativo && s.profissionaisAtivos > 0,
  };
}

/** O id vem da rota ou de um campo oculto: só texto; malformado, inexistente ou de outro salão → 404. */
function exigirId(id: unknown): string {
  if (typeof id !== 'string') {
    throw new NaoEncontrado();
  }
  return id;
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const INVALIDO_PROFISSIONAIS: ResultadoSalvarServico = Object.freeze({
  resultado: 'invalido',
  erros: Object.freeze({ profissionais: MENSAGENS_SERVICO.profissionais }),
}) as ResultadoSalvarServico;

/**
 * RN-4, RN-10, D-17: trava FOR SHARE os profissionais escolhidos e confere que todos são ativos e do
 * salão. Falso → o chamador recusa sem nenhuma escrita (RN-13).
 */
async function travarProfissionais(t: Repos, ctx: TenantContext, dados: DadosServicoValidos): Promise<boolean> {
  const encontrados = await t.servicos.travarProfissionaisParaVinculo(ctx, dados.profissionais);
  return encontrados.length === dados.profissionais.length;
}

/** Lista do painel (D-10: ativos primeiro, por nome). */
export async function listarParaPainel(ctx: TenantContext): Promise<ServicoResumo[]> {
  exigirPermissao(ctx, 'servico.gerir');
  const lista = await repos().servicos.listarParaPainel(ctx);
  return lista.map(resumo);
}

/** Serviço para a página de edição, com os profissionais para vínculo (D-5); NaoEncontrado se não for do salão. */
export async function obterParaEdicao(ctx: TenantContext, id: unknown): Promise<ServicoEdicao> {
  exigirPermissao(ctx, 'servico.gerir');
  const r = repos();
  const s = resumo(await r.servicos.buscarParaPainel(ctx, exigirId(id)));
  const profissionais = await r.servicos.listarProfissionaisParaVinculo(ctx, s.id);
  return { id: s.id, nome: s.nome, precoCentavos: s.precoCentavos, duracaoMin: s.duracaoMin, ativo: s.ativo, ofertavel: s.ofertavel, profissionais };
}

/** Profissionais ativos do salão para o formulário de criação (D-13), nenhum marcado. */
export async function listarProfissionaisParaNovo(ctx: TenantContext): Promise<ProfissionalOpcao[]> {
  exigirPermissao(ctx, 'servico.gerir');
  const ativos = await repos().profissionais.listarAtivos(ctx);
  return ativos.map((p) => ({ id: p.id, nome: p.nome, ativo: true, vinculado: false }));
}

/** RN-1, RN-4, RN-13, D-13: cria o serviço (ativo) e os vínculos numa única transação. */
export async function criar(ctx: TenantContext, e: unknown): Promise<ResultadoSalvarServico> {
  exigirPermissao(ctx, 'servico.gerir');
  const v = validarDadosServico(e);
  if (!v.ok) {
    return { resultado: 'invalido', erros: v.erros };
  }
  const { profissionais, ...dados } = v.dados;
  return emTransacao(async (t) => {
    if (!(await travarProfissionais(t, ctx, v.dados))) {
      return INVALIDO_PROFISSIONAIS;
    }
    const novo = await t.servicos.criar(ctx, dados);
    const vinculos = await t.servicos.substituirVinculosAtivos(ctx, novo.id, profissionais);
    registrar('servico.salvo', {
      salaoId: ctx.salaoId,
      servicoId: novo.id,
      operacao: 'criar',
      vinculosAdicionados: vinculos.adicionados,
      vinculosRemovidos: vinculos.removidos,
    });
    return { resultado: 'salvo', servico: resumo(await t.servicos.buscarParaPainel(ctx, novo.id)) };
  });
}

/**
 * RN-1, RN-3, RN-4, RN-10, RN-13, D-18: validação pura → profissionais (FOR SHARE) → serviço
 * (FOR NO KEY UPDATE; 404 se não for do salão) → dados → vínculos com ativos. Serviço inativo também
 * pode ser editado. Nenhuma reserva é tocada (snapshot).
 */
export async function editar(ctx: TenantContext, e: unknown): Promise<ResultadoSalvarServico> {
  exigirPermissao(ctx, 'servico.gerir');
  if (!ehObjeto(e)) {
    return { resultado: 'invalido', erros: { formulario: MENSAGENS_SERVICO.formulario } };
  }
  const { id: idBruto, ...entrada } = e;
  const id = exigirId(idBruto);
  const v = validarDadosServico(entrada);
  if (!v.ok) {
    return { resultado: 'invalido', erros: v.erros };
  }
  const { profissionais, ...dados } = v.dados;
  return emTransacao(async (t) => {
    if (!(await travarProfissionais(t, ctx, v.dados))) {
      return INVALIDO_PROFISSIONAIS;
    }
    await t.servicos.travarParaAlteracao(ctx, id);
    await t.servicos.atualizarDados(ctx, id, dados);
    const vinculos = await t.servicos.substituirVinculosAtivos(ctx, id, profissionais);
    registrar('servico.salvo', {
      salaoId: ctx.salaoId,
      servicoId: id,
      operacao: 'editar',
      vinculosAdicionados: vinculos.adicionados,
      vinculosRemovidos: vinculos.removidos,
    });
    return { resultado: 'salvo', servico: resumo(await t.servicos.buscarParaPainel(ctx, id)) };
  });
}

/** RN-2, RN-9: só a linha do serviço muda; vínculos e reservas ficam. Idempotente. */
async function definirSituacao(ctx: TenantContext, e: unknown, ativo: boolean): Promise<ResultadoSituacaoServico> {
  exigirPermissao(ctx, 'servico.gerir');
  const id = exigirId(ehObjeto(e) ? e.id : undefined);
  const servico = await emTransacao(async (t) => {
    await t.servicos.definirAtivo(ctx, id, ativo);
    return t.servicos.buscarParaPainel(ctx, id);
  });
  registrar('servico.situacao_alterada', { salaoId: ctx.salaoId, servicoId: id, ativo });
  return { resultado: ativo ? 'reativado' : 'desativado', ofertavel: resumo(servico).ofertavel };
}

export async function desativar(ctx: TenantContext, e: unknown): Promise<ResultadoSituacaoServico> {
  return definirSituacao(ctx, e, false);
}

export async function reativar(ctx: TenantContext, e: unknown): Promise<ResultadoSituacaoServico> {
  return definirSituacao(ctx, e, true);
}
