import type pg from 'pg';

import type { DepsSaloes, EntradaEditarSalao } from '@/server/admin/saloes';
import type { DetalheSalao } from '@/server/admin/saloes-tipos';
import { obterPrisma } from '@/server/repos/db';
import { criarAdminContext } from '@/server/tenant/context';
import type { AdminContext } from '@/server/tenant/context';
import type { CredenciaisAdmin } from '@/server/tenant/define-acao-admin';

import { criarSuperAdmin } from './auth';
import { criarAssinaturaEm } from './assinatura';
import type { CamposTeste, EstadoAssinaturaTeste } from './assinatura';
import { criarSalaoCompleto } from './factories';
import type { SalaoCompleto, SobrescritasSalao } from './factories';
import { slugNovo } from './sql';
import { criarEmailSimulado } from '@/server/integrations/email/simulado';
import { criarMercadoPagoSimulado } from '@/server/integrations/mercadopago/simulado';

// Apoio dos testes de salões no painel do super admin (D-044). SQL direto pelo driver `pg` ou Prisma; sem mocks de banco.

export type AdminDeTeste = { usuarioId: string; ctx: AdminContext; cred: CredenciaisAdmin };

/** Super admin com sessão com TOTP verificado (credencial do cookie `ab_admin`) e o contexto. */
export async function adminDeTeste(): Promise<AdminDeTeste> {
  const a = await criarSuperAdmin({ totpVerificado: true });
  return { usuarioId: a.usuarioId, ctx: criarAdminContext(a.usuarioId), cred: { admin: a.credencial, salao: null } };
}

export const DIA_MS = 24 * 60 * 60 * 1000;

/** Salão completo + assinatura em `estado`, sem vínculo com o provedor. */
export async function salaoComAssinatura(
  estado: EstadoAssinaturaTeste | null,
  campos: CamposTeste = {},
  sobre: SobrescritasSalao = {},
): Promise<SalaoCompleto & { assinaturaId: string | null }> {
  const s = await criarSalaoCompleto(sobre);
  const assinaturaId = estado === null ? null : await criarAssinaturaEm(s.salaoId, estado, campos);
  return { ...s, assinaturaId };
}

/** Entrada do formulário de edição com os valores atuais (nada muda) e as alterações pedidas. */
export function entradaIgual(d: DetalheSalao, mudar: Partial<Record<string, unknown>> = {}): EntradaEditarSalao {
  return {
    salaoId: d.id,
    nome: d.nome,
    slug: d.slug,
    fuso: d.fuso,
    grade: String(d.gradeMin),
    antecedencia: String(d.antecedenciaMin / 60),
    janela: String(d.janelaDias),
    intervalo: String(d.intervaloMin),
    gestorNome: d.gestor?.nome ?? '',
    gestorEmail: d.gestor?.email ?? '',
    ...mudar,
  };
}

/** Prefixo único por execução para isolar a busca da lista. */
export const prefixoUnico = (): string => slugNovo().replace(/[^a-z0-9]/g, '');

export type LinhaSalaoDb = {
  nome: string;
  fuso: string;
  grade_min: number;
  antecedencia_min: number;
  janela_dias: number;
  intervalo_min: number;
  suspenso_manual_em: Date | null;
  atualizado_em: Date;
};

export async function salaoNoBanco(c: pg.Client, id: string): Promise<LinhaSalaoDb> {
  const { rows } = await c.query<LinhaSalaoDb>(
    'SELECT nome, fuso, grade_min, antecedencia_min, janela_dias, intervalo_min, suspenso_manual_em, atualizado_em FROM salao WHERE id = $1',
    [id],
  );
  return rows[0];
}

export async function slugsNoBanco(c: pg.Client, id: string): Promise<{ slug: string; atual: boolean }[]> {
  const { rows } = await c.query<{ slug: string; atual: boolean }>(
    'SELECT slug, atual FROM salao_slug WHERE salao_id = $1 ORDER BY slug',
    [id],
  );
  return rows;
}

export type LinhaUsuarioDb = { nome: string; email: string; senha_hash: string; email_confirmado_em: Date | null };

export async function usuarioNoBanco(c: pg.Client, id: string): Promise<LinhaUsuarioDb> {
  const { rows } = await c.query<LinhaUsuarioDb>('SELECT nome, email, senha_hash, email_confirmado_em FROM usuario WHERE id = $1', [id]);
  return rows[0];
}

export async function sessoesAtivas(c: pg.Client, usuarioId: string): Promise<number> {
  const { rows } = await c.query<{ n: string }>('SELECT count(*) AS n FROM sessao WHERE usuario_id = $1 AND revogada_em IS NULL', [usuarioId]);
  return Number(rows[0].n);
}

export async function tokensPendentes(c: pg.Client, usuarioId: string, tipo: 'confirmacao_email' | 'recuperacao_senha'): Promise<number> {
  const { rows } = await c.query<{ n: string }>(
    `SELECT count(*) AS n FROM token WHERE usuario_id = $1 AND tipo = $2::tipo_token AND usado_em IS NULL AND invalidado_em IS NULL`,
    [usuarioId, tipo],
  );
  return Number(rows[0].n);
}

export async function criarTokenPendente(c: pg.Client, usuarioId: string, tipo: 'confirmacao_email' | 'recuperacao_senha'): Promise<void> {
  await c.query(
    `INSERT INTO token (usuario_id, tipo, token_hash, expira_em) VALUES ($1, $2::tipo_token, $3, now() + interval '1 hour')`,
    [usuarioId, tipo, `h-${Math.random().toString(36).slice(2)}-${Date.now()}`],
  );
}

export const assinaturaNoBanco = (id: string) => obterPrisma().assinatura.findUniqueOrThrow({ where: { id } });

export async function emailsEnviados(c: pg.Client, para: string): Promise<{ assunto: string; corpo: string }[]> {
  const { rows } = await c.query<{ assunto: string; corpo: string }>(
    'SELECT assunto, corpo FROM email_log WHERE destinatario = $1 ORDER BY criado_em, id',
    [para],
  );
  return rows;
}

export const APP_URL = 'http://localhost:3000';
export const mp = criarMercadoPagoSimulado({ appUrl: APP_URL });
/** Dependências simuladas do serviço: e-mail em `email_log`, MP simulado, URL fixa. */
export const DEPS: DepsSaloes = { email: criarEmailSimulado(), appUrl: APP_URL, mp, log: () => {} };

/** Salão mínimo (salão + slug atual + gestor com hash de mentira), para volume. Sem assinatura. */
export async function salaoLeve(nome: string): Promise<{ salaoId: string }> {
  const db = obterPrisma();
  const s = await db.salao.create({ data: { nome }, select: { id: true } });
  await db.salaoSlug.create({ data: { slug: slugNovo(), salaoId: s.id, atual: true } });
  await db.usuario.create({
    data: { salaoId: s.id, papel: 'gestor', email: `${slugNovo()}@exemplo.com.br`, nome: 'Gestor leve', senhaHash: 'hash-de-teste', emailConfirmadoEm: new Date() },
  });
  return { salaoId: s.id };
}

/**
 * Salão completo com assinatura local vinculada a uma assinatura AUTORIZADA do MP simulado (salvo
 * `semVinculo`). O fim do teste padrão é daqui a 20 dias, no relógio real: o simulado compara a nova data com `new Date()`.
 */
export async function salaoEmTeste(
  o: { estado?: EstadoAssinaturaTeste; fim?: Date | null; fimEmDias?: number; semVinculo?: boolean } = {},
): Promise<SalaoCompleto & { assinaturaId: string; fim: Date | null; simId: string | null }> {
  const s = await criarSalaoCompleto();
  const fim = o.fim === undefined ? new Date(Date.now() + (o.fimEmDias ?? 20) * DIA_MS) : o.fim;
  const assinaturaId = await criarAssinaturaEm(s.salaoId, o.estado ?? 'em_teste', { testeFimEm: fim });
  let simId: string | null = null;
  if (o.semVinculo !== true) {
    const criada = await mp.criarAssinatura({ salaoId: s.salaoId, emailPagador: s.gestor.email, urlRetorno: `${APP_URL}/painel/assinatura/retorno` });
    simId = criada.assinaturaId;
    await mp.autorizar(simId);
    await obterPrisma().assinatura.update({ where: { id: assinaturaId }, data: { provedorAssinaturaId: simId } });
  }
  return { ...s, assinaturaId, fim, simId };
}
