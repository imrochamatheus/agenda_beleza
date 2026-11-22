import { formatarDataHora } from '@/lib/format';
import { exigirPermissao } from '@/server/auth/permissoes';
import { repos } from '@/server/repos';
import type { ProfissionalPainelDTO } from '@/server/repos/tipos';
import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';

import { MENSAGENS_PROFISSIONAL, ROTULO_CLIENTE_REMOVIDA } from './tipos';
import type {
  ProfissionalVisao,
  ResultadoDesativar,
  ResultadoEuTambemAtendo,
  ResultadoReativar,
  ResultadoSalvar,
} from './tipos';
import { normalizarEmailOpcional, validarDadosProfissional } from './validacao';

// Serviço de domínio da gestão de profissionais (D-013 §3.5; RN-1..RN-10, RN-12). Sem next/*: as
// ações (profissionais.acao.ts) e as páginas o chamam. Toda função confere a matriz de permissões
// (defesa em profundidade, além de `papeis: ['gestor']` na ação) e só usa o salão do contexto.
// Resultados de negócio são discriminados (`invalido`, `recusado`…); acesso e existência continuam
// como ErroDeDominio (401/403/404).

/** Log estruturado de uma linha, sem nomes, e-mails nem telefones. */
function registrar(evento: string, dados: Record<string, unknown>): void {
  console.info(JSON.stringify({ evento, ...dados }));
}

function visao(ctx: TenantContext, p: ProfissionalPainelDTO): ProfissionalVisao {
  return {
    id: p.id,
    nome: p.nome,
    email: p.email,
    ativo: p.ativo,
    acesso: p.usuarioId !== null && p.usuarioId === ctx.usuarioId ? 'voce' : p.vinculo ? 'com_acesso' : 'sem_acesso',
    emailLogin: p.vinculo?.emailLogin ?? null,
    emailBloqueado: p.usuarioId !== null,
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

/** Lista do painel (D-9: ativos primeiro, por nome). */
export async function listarParaPainel(ctx: TenantContext): Promise<ProfissionalVisao[]> {
  exigirPermissao(ctx, 'profissional.gerir');
  const lista = await repos().profissionais.listarParaPainel(ctx);
  return lista.map((p) => visao(ctx, p));
}

/** Profissional para a página de edição; NaoEncontrado se não for do salão. */
export async function obterParaEdicao(ctx: TenantContext, id: unknown): Promise<ProfissionalVisao> {
  exigirPermissao(ctx, 'profissional.gerir');
  return visao(ctx, await repos().profissionais.buscarParaPainel(ctx, exigirId(id)));
}

/** RN-9, RN-12: novo profissional ativo, sem usuário vinculado. */
export async function criar(ctx: TenantContext, e: unknown): Promise<ResultadoSalvar> {
  exigirPermissao(ctx, 'profissional.gerir');
  const v = validarDadosProfissional(e);
  if (!v.ok) {
    return { resultado: 'invalido', erros: v.erros };
  }
  const r = repos();
  const criado = await r.profissionais.criar(ctx, v.dados);
  return { resultado: 'salvo', profissional: visao(ctx, { ...criado, vinculo: null }) };
}

/**
 * RN-9, D-17, D-039 RN-7: com usuário vinculado, o e-mail do perfil não muda (igual ao atual é ignorado,
 * diferente é recusado); `usuario.email` nunca é tocado.
 */
export async function editar(ctx: TenantContext, e: unknown, agora: Date = new Date()): Promise<ResultadoSalvar> {
  exigirPermissao(ctx, 'profissional.gerir');
  if (!ehObjeto(e)) {
    return { resultado: 'invalido', erros: { formulario: MENSAGENS_PROFISSIONAL.formulario } };
  }
  const { id: idBruto, ...dados } = e;
  const id = exigirId(idBruto);
  const v = validarDadosProfissional(dados);
  if (!v.ok) {
    return { resultado: 'invalido', erros: v.erros };
  }
  return emTransacao(async (t) => {
    const trava = await t.profissionais.travarParaAlteracao(ctx, id);
    let email = v.dados.email;
    if (trava.usuarioId !== null) {
      const informado = Object.hasOwn(dados, 'email');
      if (informado && email !== (normalizarEmailOpcional(trava.email) ?? trava.email)) {
        return { resultado: 'invalido', erros: { email: MENSAGENS_PROFISSIONAL.emailBloqueado } };
      }
      email = trava.email;
    }
    // D-039 RN-7: trocar o e-mail do perfil invalida os convites pendentes, na mesma transação (a trava
    // FOR UPDATE do profissional já está tomada; ordem profissional → convite).
    if (email !== (normalizarEmailOpcional(trava.email) ?? trava.email)) {
      await t.convites.invalidarPendentes(ctx, id, agora);
    }
    await t.profissionais.atualizarDados(ctx, id, { nome: v.dados.nome, email });
    return { resultado: 'salvo', profissional: visao(ctx, await t.profissionais.buscarParaPainel(ctx, id)) };
  });
}

/**
 * RN-1, RN-2, RN-7, RN-8, D-18. Uma transação: trava FOR UPDATE → reservas bloqueantes (recusa sem
 * escrita) → desativa, revoga as sessões do usuário `profissional` vinculado (nunca as do gestor) e
 * invalida os convites pendentes. Já inativo: reaplica os efeitos (idempotente).
 */
export async function desativar(ctx: TenantContext, e: unknown, agora: Date): Promise<ResultadoDesativar> {
  exigirPermissao(ctx, 'profissional.gerir');
  const id = exigirId(ehObjeto(e) ? e.id : undefined);
  const r = await emTransacao(async (t): Promise<ResultadoDesativar> => {
    const trava = await t.profissionais.travarParaAlteracao(ctx, id);
    const bloqueantes = await t.reservas.listarBloqueantesDeDesativacao(ctx, id, agora);
    if (bloqueantes.length > 0) {
      return {
        resultado: 'recusado',
        reservas: bloqueantes.map((b) => ({
          id: b.id,
          inicio: b.inicio.toISOString(),
          inicioLocal: formatarDataHora(b.inicio, trava.fusoSalao),
          servicos: b.servicos,
          cliente: b.clienteNome ?? ROTULO_CLIENTE_REMOVIDA,
        })),
      };
    }
    const efeitos = await t.profissionais.aplicarDesativacao(ctx, id, {
      agora,
      revogarSessoesDe: trava.papelUsuario === 'profissional' ? trava.usuarioId : null,
    });
    registrar('profissional.desativado', { salaoId: ctx.salaoId, profissionalId: id, ...efeitos });
    return { resultado: 'desativado' };
  });
  if (r.resultado === 'recusado') {
    registrar('profissional.desativacao_recusada', {
      salaoId: ctx.salaoId,
      profissionalId: id,
      quantidade: r.reservas.length,
    });
  }
  return r;
}

/** RN-10: reativa; não restaura sessões nem convites. */
export async function reativar(ctx: TenantContext, e: unknown): Promise<ResultadoReativar> {
  exigirPermissao(ctx, 'profissional.gerir');
  const id = exigirId(ehObjeto(e) ? e.id : undefined);
  await emTransacao(async (t) => {
    await t.profissionais.travarParaAlteracao(ctx, id);
    await t.profissionais.reativar(ctx, id);
  });
  return { resultado: 'reativado' };
}

/** RN-3: cria ou reativa o perfil vinculado ao gestor da sessão; nunca um segundo. */
export async function euTambemAtendo(ctx: TenantContext): Promise<ResultadoEuTambemAtendo> {
  exigirPermissao(ctx, 'profissional.gerir');
  if (ctx.papel !== 'gestor') {
    throw new AcessoNegado('só o gestor declara que atende');
  }
  const r = await emTransacao((t) => t.profissionais.garantirPerfilDoGestor(ctx));
  return { resultado: r.resultado, profissionalId: r.id };
}
