import { registrarAuditoria, registrarFalhaAuditoria } from '@/server/auditoria/registrar';
import { enviarLinkDeConfirmacao, novoTokenDeConfirmacao } from '@/server/auth/confirmacao-email';
import type { DepsConfirmacao } from '@/server/auth/confirmacao-email';
import { ErroMercadoPago } from '@/server/integrations/mercadopago/port';
import type { PortaMercadoPago } from '@/server/integrations/mercadopago/port';
import { NaoImplementado } from '@/server/integrations/nao-implementado';
import { integracoes } from '@/server/integrations/registry';
import { emTransacaoSaloes, lerDetalhe, lerParaExtensao, listarSaloes as consultarLista } from '@/server/repos/admin-saloes';
import { ehUuid } from '@/server/repos/ids';
import { contextoDeSistema, exigirAdmin } from '@/server/tenant/context';
import type { AdminContext } from '@/server/tenant/context';
import { MENSAGENS_CONFIGURACOES } from '@/server/salao/tipos';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehViolacaoDeEmailUnico } from './erros-banco';
import { DIA_MS, MENSAGENS_ADMIN_SALOES, POR_PAGINA_SALOES } from './saloes-tipos';
import type {
  DetalheSalao,
  ErrosEdicao,
  FiltrosSaloes,
  ListaSaloes,
  ResultadoEdicao,
  ResultadoExtensao,
  ResultadoSuspensao,
} from './saloes-tipos';
import { alteraSalao, diferencaDoSalao, recusaDaExtensao, validarDias, validarEdicao, validarMotivo } from './saloes-validacao';
import type { EntradaEdicao } from './saloes-validacao';

// Salões no painel do super admin (D-044, E8.2). Sem next/*, sem 'use server', sem Prisma (o repositório
// de plataforma é `repos/admin-saloes.ts`). Cada operação usa só o `salaoId` informado, validado como UUID
// e existente (404); nada passa pela política de operação de salão. As operações que reutilizam
// `RepoSalao`/`RepoAssinatura` (escopados por contexto) montam um contexto de SISTEMA para o `salaoId`
// validado: a decisão de permissão já foi tomada por `defineAcaoAdmin` (R-5 do design, resolvido).
//
// Toda mutação grava a auditoria NA MESMA transação (`registrarAuditoria`); toda resposta de negócio fora do
// sucesso é uma sentinela lançada DENTRO da transação (desfaz o que houver) e capturada FORA dela. Nenhuma
// chamada de provedor, e-mail ou fila acontece dentro de transação. Os motivos digitados vivem só na
// auditoria (`depois.motivo`): nunca em log.

const ORIGEM = 'admin-saloes';

/** Dependências injetáveis (testes). Em produção vêm todas do padrão. */
export type DepsSaloes = Pick<DepsConfirmacao, 'email' | 'appUrl' | 'gerarToken' | 'log'> & {
  mp?: PortaMercadoPago;
  /** Só testes: roda depois da chamada ao provedor e antes da transação que grava (corrida pós-provedor). */
  aposProvedor?: () => Promise<void>;
};

const iso = (d: Date): string => d.toISOString();

/** Resposta de negócio lançada na transação para desfazê-la; nunca sai do módulo. */
class Desfazer<T> extends Error {
  constructor(readonly resposta: T) {
    super('desfazer');
    this.name = 'Desfazer';
  }
}

function exigirIdDeSalao(id: unknown): string {
  if (!ehUuid(id)) throw new NaoEncontrado();
  return id;
}

/** Salão existente ou NaoEncontrado (404 sem vazar nada). */
async function exigirSalao(id: string) {
  const d = await lerDetalhe(id);
  if (d === null) throw new NaoEncontrado();
  return d;
}

export async function listarSaloes(ctx: AdminContext, f: FiltrosSaloes & { chave: string }): Promise<ListaSaloes> {
  exigirAdmin(ctx);
  const { itens, total } = await consultarLista({ chave: f.chave, estado: f.estado, suspenso: f.suspenso, pagina: f.pagina });
  return { itens, total, pagina: f.pagina, porPagina: POR_PAGINA_SALOES };
}

export async function lerSalao(ctx: AdminContext, id: unknown): Promise<DetalheSalao> {
  exigirAdmin(ctx);
  const d = await exigirSalao(exigirIdDeSalao(id));
  return {
    id: d.id,
    nome: d.nome,
    slug: d.slug,
    fuso: d.fuso,
    gradeMin: d.gradeMin,
    antecedenciaMin: d.antecedenciaMin,
    janelaDias: d.janelaDias,
    intervaloMin: d.intervaloMin,
    suspensoEm: d.suspensoManualEm === null ? null : iso(d.suspensoManualEm),
    gestor: d.gestor,
    assinatura:
      d.assinatura === null
        ? null
        : {
            estado: d.assinatura.estado,
            testeFimEm: d.assinatura.testeFimEm === null ? null : iso(d.assinatura.testeFimEm),
            vinculada: d.assinatura.vinculada,
          },
  };
}

export type EntradaEditarSalao = EntradaEdicao & { salaoId: unknown };

type Envio = { para: string; nomeGestor: string; nomeSalao: string; token: string };

/**
 * Edita nome, slug, fuso, regras da agenda e nome/e-mail do gestor. Uma transação: `salao` (FOR NO KEY
 * UPDATE) → gestor (FOR UPDATE) → validação contra o estado TRAVADO → diff (nada mudou: nada se grava, nada se
 * audita) → slug → regras → gestor (e-mail novo: desconfirma, revoga sessões, invalida tokens pendentes e emite
 * o token de confirmação) → auditoria. O e-mail da confirmação sai DEPOIS do commit; a falha dele só é informada.
 * A senha nunca é lida nem gravada.
 */
export async function editarSalao(
  ctx: AdminContext,
  e: EntradaEditarSalao,
  agora: Date,
  deps: DepsSaloes = {},
): Promise<ResultadoEdicao> {
  exigirAdmin(ctx);
  const salaoId = exigirIdDeSalao(e.salaoId);
  await exigirSalao(salaoId);
  const sctx = contextoDeSistema(salaoId, ORIGEM);
  type Fim = { resultado: ResultadoEdicao; envio: Envio | null };
  let fim: Fim;
  try {
    fim = await emTransacaoSaloes(async (op, r): Promise<Fim> => {
      await r.saloes.travar(sctx);
      const cfg = await r.saloes.obterConfiguracoes(sctx);
      const { atual: slug } = await r.saloes.listarSlugs(sctx);
      const gestor = await op.travarGestor(salaoId);
      const atual = { ...cfg, slug, gestor: gestor === null ? null : { nome: gestor.nome, email: gestor.email } };

      const v = validarEdicao(e, atual);
      if (!v.ok) throw new Desfazer<Fim>({ resultado: { resultado: 'invalido', erros: v.erros }, envio: null });
      if (v.vazio) return { resultado: { resultado: 'sem_mudanca' }, envio: null };
      const m = v.mudancas;

      if (gestor !== null && m.gestorEmail !== null && (await op.emailEmUso(m.gestorEmail, gestor.id))) {
        const erros: ErrosEdicao = { gestorEmail: MENSAGENS_ADMIN_SALOES.emailEmUso };
        throw new Desfazer<Fim>({ resultado: { resultado: 'email_em_uso', erros }, envio: null });
      }
      if (m.slug !== null && (await r.saloes.trocarSlug(sctx, m.slug)) === 'em_uso') {
        const erros: ErrosEdicao = { slug: MENSAGENS_CONFIGURACOES.slugEmUso };
        throw new Desfazer<Fim>({ resultado: { resultado: 'conflito_slug', erros }, envio: null });
      }
      if (Object.keys(m.regrasAlteradas).length > 0) {
        await r.saloes.atualizarConfiguracoes(sctx, m.regras);
      }

      let envio: Envio | null = null;
      if (gestor !== null && (m.gestorNome !== null || m.gestorEmail !== null)) {
        await op.atualizarGestor({ id: gestor.id, nome: m.gestorNome, email: m.gestorEmail, agora });
        if (m.gestorEmail !== null) {
          await op.revogarSessoes(gestor.id, agora);
          await op.invalidarTokensPendentes(gestor.id, agora);
          const t = novoTokenDeConfirmacao(agora, deps.gerarToken);
          await op.inserirTokenConfirmacao({ usuarioId: gestor.id, tokenHash: t.tokenHash, expiraEm: t.expiraEm, agora });
          envio = { para: m.gestorEmail, nomeGestor: m.gestorNome ?? gestor.nome, nomeSalao: m.regras.nome, token: t.token };
        }
      }

      if (alteraSalao(m)) {
        const { antes, depois } = diferencaDoSalao(atual, m);
        await registrarAuditoria(ctx, { acao: 'salao.atualizar', entidade: 'salao', entidadeId: salaoId, salaoId, antes, depois }, r);
      }
      if (gestor !== null && m.gestorEmail !== null) {
        await registrarAuditoria(
          ctx,
          {
            acao: 'usuario.atualizar_email',
            entidade: 'usuario',
            entidadeId: gestor.id,
            salaoId,
            antes: { email: gestor.email, email_confirmado: gestor.confirmado },
            depois: { email: m.gestorEmail, email_confirmado: false },
          },
          r,
        );
      }
      return { resultado: { resultado: 'editado' }, envio };
    });
  } catch (erro) {
    if (erro instanceof Desfazer) {
      return (erro as Desfazer<Fim>).resposta.resultado;
    }
    // Corrida com outro cadastro pelo mesmo e-mail: a transação inteira foi desfeita.
    if (ehViolacaoDeEmailUnico(erro)) {
      return { resultado: 'email_em_uso', erros: { gestorEmail: MENSAGENS_ADMIN_SALOES.emailEmUso } };
    }
    throw erro;
  }

  if (fim.envio === null) return fim.resultado;
  const confirmacao = await enviarLinkDeConfirmacao(deps, fim.envio);
  return { resultado: 'editado', confirmacao };
}

export type EntradaSuspender = { salaoId: unknown; motivo: unknown; etapa: unknown };

/**
 * Suspende manualmente (só `salao.suspenso_manual_em`; a assinatura e as sessões não são tocadas). Etapa
 * `previa` é pura (valida e devolve a confirmação); só `confirmar` grava. Já suspenso → `sem_efeito`.
 */
export async function suspenderSalao(ctx: AdminContext, e: EntradaSuspender, agora: Date): Promise<ResultadoSuspensao> {
  exigirAdmin(ctx);
  const salaoId = exigirIdDeSalao(e.salaoId);
  const detalhe = await exigirSalao(salaoId);
  const m = validarMotivo(e.motivo);
  if (!m.ok) return { resultado: 'invalido', erros: { motivo: m.erro } };
  if (e.etapa !== 'confirmar') {
    return detalhe.suspensoManualEm === null ? { resultado: 'previa', motivo: m.motivo } : { resultado: 'sem_efeito' };
  }
  const sctx = contextoDeSistema(salaoId, ORIGEM);
  return emTransacaoSaloes(async (op, r): Promise<ResultadoSuspensao> => {
    await r.saloes.travar(sctx);
    if (!(await op.suspender(salaoId, agora))) return { resultado: 'sem_efeito' };
    await registrarAuditoria(
      ctx,
      {
        acao: 'salao.suspender',
        entidade: 'salao',
        entidadeId: salaoId,
        salaoId,
        antes: { suspenso_manual_em: null },
        depois: { suspenso_manual_em: iso(agora), motivo: m.motivo },
      },
      r,
    );
    return { resultado: 'suspenso' };
  });
}

export type EntradaReativar = { salaoId: unknown; motivo?: unknown };

/** Reativa (uma etapa só). Motivo opcional: vazio = sem motivo; preenchido, segue a regra do motivo. Já ativo → `sem_efeito`. */
export async function reativarSalao(ctx: AdminContext, e: EntradaReativar, agora: Date): Promise<ResultadoSuspensao> {
  exigirAdmin(ctx);
  const salaoId = exigirIdDeSalao(e.salaoId);
  await exigirSalao(salaoId);
  let motivo: string | null = null;
  if (typeof e.motivo === 'string' && e.motivo.trim() !== '') {
    const m = validarMotivo(e.motivo);
    if (!m.ok) return { resultado: 'invalido', erros: { motivo: m.erro } };
    motivo = m.motivo;
  }
  const sctx = contextoDeSistema(salaoId, ORIGEM);
  return emTransacaoSaloes(async (op, r): Promise<ResultadoSuspensao> => {
    await r.saloes.travar(sctx);
    const antes = await op.suspensaoDoSalao(salaoId);
    if (antes === null || !(await op.reativar(salaoId, agora))) return { resultado: 'sem_efeito' };
    await registrarAuditoria(
      ctx,
      {
        acao: 'salao.reativar',
        entidade: 'salao',
        entidadeId: salaoId,
        salaoId,
        antes: { suspenso_manual_em: iso(antes) },
        depois: { suspenso_manual_em: null, ...(motivo === null ? {} : { motivo }) },
      },
      r,
    );
    return { resultado: 'reativado' };
  });
}

export type EntradaEstender = { salaoId: unknown; dias: unknown; testeFimEmEsperado?: unknown; etapa: unknown };

function codigoDoErro(e: unknown): string {
  if (e instanceof ErroMercadoPago) return e.codigo;
  if (e instanceof NaoImplementado) return 'nao_implementado';
  return 'erro_desconhecido';
}

/**
 * Estende o teste gratuito em N dias de 24 h (UTC) de uma assinatura `em_teste`. Leitura sem trava (as recusas
 * não chamam o provedor) → etapa `previa` para aqui → D esperado otimista (`mudou` ANTES do provedor) →
 * `mp.adiarProximaCobranca` FORA de transação → transação curta: `assinatura` (FOR NO KEY UPDATE) → UPDATE
 * condicional ao estado `em_teste` E ao D lido → auditoria. Sem trava de `salao`, como webhook, retorno e job.
 * Falha do provedor ou 0 linhas depois do provedor: nada muda localmente e a falha é auditada em conexão
 * própria (`registrarFalhaAuditoria`); a divergência provedor × local exige conferência manual (R-1).
 */
export async function estenderTeste(
  ctx: AdminContext,
  e: EntradaEstender,
  agora: Date,
  deps: DepsSaloes = {},
): Promise<ResultadoExtensao> {
  const adminId = exigirAdmin(ctx);
  const salaoId = exigirIdDeSalao(e.salaoId);
  const lido = await lerParaExtensao(salaoId);
  if (!lido.existe) throw new NaoEncontrado();
  const d = validarDias(e.dias);
  if (!d.ok) return { resultado: 'invalido', erros: { dias: d.erro } };
  const a = lido.assinatura;
  const recusa = recusaDaExtensao(
    { estado: a?.estado ?? null, temProvedor: a?.provedorAssinaturaId != null, testeFimEm: a?.testeFimEm ?? null },
    agora,
  );
  if (recusa !== null) return { resultado: 'recusado', motivo: recusa };
  // Sem recusa: há assinatura em teste, com vínculo e fim futuro.
  if (a === null || a.provedorAssinaturaId === null || a.testeFimEm === null) throw new Error('estenderTeste: assinatura inconsistente');
  const de = a.testeFimEm;
  const para = new Date(de.getTime() + d.dias * DIA_MS);
  if (e.etapa !== 'confirmar') return { resultado: 'previa', de: iso(de), para: iso(para), dias: d.dias };

  const esperado = typeof e.testeFimEmEsperado === 'string' ? new Date(e.testeFimEmEsperado) : null;
  if (esperado === null || Number.isNaN(esperado.getTime())) {
    return { resultado: 'invalido', erros: { dias: MENSAGENS_ADMIN_SALOES.formulario } };
  }
  if (esperado.getTime() !== de.getTime()) return { resultado: 'mudou', novoFim: iso(de) };

  const falha = (depois: Record<string, string | number>) =>
    registrarFalhaAuditoria({
      acao: 'salao.estender_teste',
      entidade: 'assinatura',
      entidadeId: a.id,
      salaoId,
      atorId: adminId,
      depois: { teste_fim_em_lido: iso(de), dias: d.dias, ...depois },
    });

  try {
    await (deps.mp ?? integracoes().mercadoPago).adiarProximaCobranca(a.provedorAssinaturaId, para);
  } catch (erro) {
    await falha({ codigo: codigoDoErro(erro) });
    return { resultado: 'provedor_falhou' };
  }
  await deps.aposProvedor?.();

  const sctx = contextoDeSistema(salaoId, ORIGEM);
  type Divergente = { novoFim: Date | null; mudouFim: boolean };
  try {
    await emTransacaoSaloes(async (op, r) => {
      const travada = await r.assinaturas.travar(sctx, { assinaturaId: a.id });
      if (travada === null || travada === 'ocupada') {
        throw new Desfazer<Divergente>({ novoFim: null, mudouFim: false });
      }
      if (!(await op.estenderTesteSeIgual({ assinaturaId: a.id, de, para, agora }))) {
        const atual = await op.lerAssinatura(a.id);
        const mudouFim = atual !== null && atual.estado === 'em_teste' && atual.testeFimEm !== null && atual.testeFimEm.getTime() !== de.getTime();
        throw new Desfazer<Divergente>({ novoFim: atual?.testeFimEm ?? null, mudouFim });
      }
      await registrarAuditoria(
        ctx,
        {
          acao: 'salao.estender_teste',
          entidade: 'assinatura',
          entidadeId: a.id,
          salaoId,
          antes: { teste_fim_em: iso(de) },
          depois: { teste_fim_em: iso(para), dias: d.dias },
        },
        r,
      );
    });
  } catch (erro) {
    if (!(erro instanceof Desfazer)) throw erro;
    const div = (erro as Desfazer<Divergente>).resposta;
    await falha({ motivo: 'estado_mudou', ...(div.novoFim === null ? {} : { teste_fim_em_atual: iso(div.novoFim) }) });
    return div.mudouFim && div.novoFim !== null ? { resultado: 'mudou', novoFim: iso(div.novoFim) } : { resultado: 'divergencia' };
  }
  return { resultado: 'estendido', de: iso(de), para: iso(para), dias: d.dias };
}
