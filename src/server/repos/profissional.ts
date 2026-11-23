import type { ContextoEscopado, TenantContext } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehUuid } from './ids';
import { revogarSessoesDoUsuario } from './sessao';
import type { ProfissionalDTO, ProfissionalPainelDTO, TravaProfissional, VinculoProfissional } from './tipos';
import type { Executor } from './transacao';

// Repositório de profissionais (D-005; D-013 §3.2). Todo método filtra pelo salão do contexto.
//
// ORDEM DE TRAVAS (D-013 §3.2; obrigação para E1.4 e E3.x): `profissional` (SELECT … FOR UPDATE OF p)
// → leitura de `reserva_item` (D-050) → `profissional` (UPDATE) → `sessao` → `convite`. Ninguém trava
// `usuario`. A trava é FOR UPDATE (nunca FOR NO KEY UPDATE): ela conflita com o FOR KEY SHARE que o
// PostgreSQL toma na linha referenciada quando alguém insere um `reserva_item`/`convite` apontando para
// ela, de modo que a desativação espera essas inserções e, ao obter a trava, enxerga o que foi
// confirmado (D-7).
// E3.2/E3.4/E3.5 devem conferir `ativo` com FOR SHARE na mesma linha antes de gravar a reserva
// (D-025: `travarParaReserva`, depois do salão FOR SHARE e antes dos serviços, com FOR NO KEY UPDATE
// (DEF-1): todo comando que INSIRA ou ATUALIZE `reserva_item` para status ocupante (criar, remarcar
// item) deve tomar FOR NO KEY UPDATE (ou mais forte) no profissional ANTES do comando. D-050: com N
// profissionais, `travarVariosParaReserva` (laço em ordem de id). Ver o cabeçalho de repos/servico.ts.)

export interface RepoProfissional {
  buscarPorId(ctx: ContextoEscopado, id: string): Promise<ProfissionalDTO>;
  /** Ativos e inativos do salão (RN-16), por nome. */
  listar(ctx: ContextoEscopado): Promise<ProfissionalDTO[]>;
  renomear(ctx: ContextoEscopado, id: string, nome: string): Promise<ProfissionalDTO>;
  /** Novo profissional ativo, sem usuário vinculado (D-013 RN-12). */
  criar(ctx: ContextoEscopado, d: { nome: string; email: string | null }): Promise<ProfissionalDTO>;
  /** D-9: ativos primeiro, depois nome, depois id. Inclui o vínculo (papel e e-mail do usuário). */
  listarParaPainel(ctx: ContextoEscopado): Promise<ProfissionalPainelDTO[]>;
  /** Um profissional com o vínculo; NaoEncontrado se inexistente, de outro salão ou ID malformado. */
  buscarParaPainel(ctx: ContextoEscopado, id: string): Promise<ProfissionalPainelDTO>;
  /** Só ativos, por nome (D-013 CA-4: "consulta de ativos do salão"). */
  listarAtivos(ctx: ContextoEscopado): Promise<ProfissionalDTO[]>;
  /**
   * SELECT … FOR UPDATE OF p na linha do profissional (com o papel do usuário vinculado e o fuso do
   * salão). Sem linha → NaoEncontrado. Só tem sentido dentro de emTransacao.
   */
  travarParaAlteracao(ctx: ContextoEscopado, id: string): Promise<TravaProfissional>;
  /**
   * D-025 A-3 (revisão DEF-1): `SELECT ativo … FOR NO KEY UPDATE OF p` do profissional do salão, para
   * reservar. A trava SERIALIZA a criação de reservas do mesmo profissional antes da revalidação e do
   * INSERT: com FOR SHARE, N transações no mesmo horário formavam ciclo nos "speculative tokens" do
   * `INSERT … ON CONFLICT DO NOTHING` + exclusion (40P01). Nunca promova FOR SHARE → FOR NO KEY UPDATE
   * na mesma transação. Id malformado ou sem linha (inexistente ou de outro salão) → null, sem consultar
   * o malformado. Só dentro de emTransacao. O texto "FOR NO KEY UPDATE OF p" é procurado em
   * pg_stat_activity pelos testes.
   */
  travarParaReserva(ctx: ContextoEscopado, id: string): Promise<{ ativo: boolean } | null>;
  /**
   * D-050 A-10/Q12: `travarParaReserva` em LAÇO, um comando por id, sobre os ids DISTINTOS em
   * minúsculas e ordenados (a ordem lexicográfica da string canônica é a ordem do uuid no PostgreSQL),
   * para que transações com conjuntos sobrepostos travem sempre na mesma ordem (sem impasse). Devolve
   * um Map por id em minúsculas: `{ ativo }` ou null (inexistente, de outro salão ou malformado; o
   * malformado não é consultado). Lista vazia → Map vazio sem consulta. Só dentro de emTransacao.
   */
  travarVariosParaReserva(ctx: ContextoEscopado, ids: readonly string[]): Promise<Map<string, { ativo: boolean } | null>>;
  /** Grava nome e e-mail; NaoEncontrado se a linha não é do salão. */
  atualizarDados(ctx: ContextoEscopado, id: string, d: { nome: string; email: string | null }): Promise<ProfissionalDTO>;
  /**
   * No MESMO executor: (1) ativo = false; (2) se `revogarSessoesDe` ≠ null, revoga as sessões
   * abertas desse usuário; (3) convites pendentes (aceito_em e invalidado_em nulos) deste
   * profissional ganham invalidado_em = agora.
   */
  aplicarDesativacao(
    ctx: ContextoEscopado,
    id: string,
    d: { agora: Date; revogarSessoesDe: string | null },
  ): Promise<{ sessoesRevogadas: number; convitesInvalidados: number }>;
  /** ativo = true; NaoEncontrado se a linha não é do salão. */
  reativar(ctx: ContextoEscopado, id: string): Promise<void>;
  /**
   * "Eu também atendo" (D-013 RN-3): cria o perfil vinculado ao gestor da sessão (INSERT … ON CONFLICT
   * DO NOTHING, sem abortar a transação na corrida), reativa o existente ou só informa. Usuário
   * inexistente ou que não é gestor do salão → NaoEncontrado.
   */
  garantirPerfilDoGestor(ctx: TenantContext): Promise<{ id: string; resultado: 'criado' | 'reativado' | 'ja_atende' }>;
}

const CAMPOS = {
  id: true,
  nome: true,
  email: true,
  usuarioId: true,
  ativo: true,
  criadoEm: true,
  atualizadoEm: true,
} as const;

const CAMPOS_PAINEL = { ...CAMPOS, usuario: { select: { papel: true, email: true } } } as const;

type LinhaPainel = ProfissionalDTO & { usuario: { papel: string; email: string } | null };

/** O vínculo só pode ser de usuário de salão (FK composta com salao_id); outro papel é ignorado. */
function vinculoDe(usuario: { papel: string; email: string } | null): VinculoProfissional | null {
  if (usuario === null || (usuario.papel !== 'gestor' && usuario.papel !== 'profissional')) {
    return null;
  }
  return { papel: usuario.papel, emailLogin: usuario.email };
}

function paraPainel({ usuario, ...p }: LinhaPainel): ProfissionalPainelDTO {
  return { ...p, vinculo: vinculoDe(usuario) };
}

/** Escopo + ID: NaoEncontrado para ID malformado ANTES de consultar. */
function escopoEId(ctx: ContextoEscopado, id: string): string {
  const salaoId = exigirEscopo(ctx);
  if (!ehUuid(id)) {
    throw new NaoEncontrado();
  }
  return salaoId;
}

export function criarRepoProfissional(db: Executor): RepoProfissional {
  async function buscarPorId(ctx: ContextoEscopado, id: string): Promise<ProfissionalDTO> {
    const salaoId = escopoEId(ctx, id);
    const profissional = await db.profissional.findFirst({ where: { id, salaoId }, select: CAMPOS });
    if (!profissional) {
      throw new NaoEncontrado();
    }
    return profissional;
  }

  /** UPDATE escopado pelo salão (Prisma grava atualizado_em); nenhuma linha → NaoEncontrado. */
  async function atualizar(
    ctx: ContextoEscopado,
    id: string,
    data: { nome?: string; email?: string | null; ativo?: boolean },
  ): Promise<void> {
    const salaoId = escopoEId(ctx, id);
    const { count } = await db.profissional.updateMany({ where: { id, salaoId }, data });
    if (count === 0) {
      throw new NaoEncontrado();
    }
  }

  async function travarParaReserva(ctx: ContextoEscopado, id: string): Promise<{ ativo: boolean } | null> {
    const salaoId = exigirEscopo(ctx);
    if (!ehUuid(id)) {
      return null;
    }
    const linhas = await db.$queryRaw<{ ativo: boolean }[]>`
      SELECT p.ativo
        FROM profissional p
       WHERE p.id = ${id}::uuid AND p.salao_id = ${salaoId}::uuid
         FOR NO KEY UPDATE OF p`;
    return linhas[0] ?? null;
  }

  return {
    buscarPorId,

    async listar(ctx) {
      const salaoId = exigirEscopo(ctx);
      return db.profissional.findMany({
        where: { salaoId },
        select: CAMPOS,
        orderBy: [{ nome: 'asc' }, { id: 'asc' }],
      });
    },

    async renomear(ctx, id, nome) {
      await atualizar(ctx, id, { nome });
      return buscarPorId(ctx, id);
    },

    async criar(ctx, d) {
      const salaoId = exigirEscopo(ctx);
      return db.profissional.create({
        data: { salaoId, nome: d.nome, email: d.email, usuarioId: null },
        select: CAMPOS,
      });
    },

    async listarParaPainel(ctx) {
      const salaoId = exigirEscopo(ctx);
      const linhas = await db.profissional.findMany({
        where: { salaoId },
        select: CAMPOS_PAINEL,
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }, { id: 'asc' }],
      });
      return linhas.map(paraPainel);
    },

    async buscarParaPainel(ctx, id) {
      const salaoId = escopoEId(ctx, id);
      const linha = await db.profissional.findFirst({ where: { id, salaoId }, select: CAMPOS_PAINEL });
      if (!linha) {
        throw new NaoEncontrado();
      }
      return paraPainel(linha);
    },

    async listarAtivos(ctx) {
      const salaoId = exigirEscopo(ctx);
      return db.profissional.findMany({
        where: { salaoId, ativo: true },
        select: CAMPOS,
        orderBy: [{ nome: 'asc' }, { id: 'asc' }],
      });
    },

    travarParaReserva,

    async travarVariosParaReserva(ctx, ids) {
      exigirEscopo(ctx);
      const ordenados = [...new Set(ids.map((id) => id.toLowerCase()))].sort();
      const travas = new Map<string, { ativo: boolean } | null>();
      for (const id of ordenados) {
        travas.set(id, await travarParaReserva(ctx, id));
      }
      return travas;
    },

    async travarParaAlteracao(ctx, id) {
      const salaoId = escopoEId(ctx, id);
      const linhas = await db.$queryRaw<
        {
          id: string;
          usuario_id: string | null;
          ativo: boolean;
          email: string | null;
          papel: string | null;
          fuso: string;
        }[]
      >`
        SELECT p.id::text AS id, p.usuario_id::text AS usuario_id, p.ativo, p.email,
               u.papel::text AS papel, s.fuso
          FROM profissional p
          JOIN salao s ON s.id = p.salao_id
          LEFT JOIN usuario u ON u.id = p.usuario_id
         WHERE p.id = ${id}::uuid AND p.salao_id = ${salaoId}::uuid
           FOR UPDATE OF p`;
      const l = linhas[0];
      if (!l) {
        throw new NaoEncontrado();
      }
      return {
        id: l.id,
        usuarioId: l.usuario_id,
        ativo: l.ativo,
        email: l.email,
        papelUsuario: l.papel === 'gestor' || l.papel === 'profissional' ? l.papel : null,
        fusoSalao: l.fuso,
      };
    },

    async atualizarDados(ctx, id, d) {
      await atualizar(ctx, id, { nome: d.nome, email: d.email });
      return buscarPorId(ctx, id);
    },

    async aplicarDesativacao(ctx, id, d) {
      const salaoId = exigirEscopo(ctx);
      await atualizar(ctx, id, { ativo: false });
      const sessoesRevogadas =
        d.revogarSessoesDe === null ? 0 : await revogarSessoesDoUsuario(d.revogarSessoesDe, d.agora, db);
      const { count: convitesInvalidados } = await db.convite.updateMany({
        where: { salaoId, profissionalId: id, aceitoEm: null, invalidadoEm: null },
        data: { invalidadoEm: d.agora },
      });
      return { sessoesRevogadas, convitesInvalidados };
    },

    async reativar(ctx, id) {
      await atualizar(ctx, id, { ativo: true });
    },

    async garantirPerfilDoGestor(ctx) {
      const salaoId = exigirEscopo(ctx);
      if ((ctx as { tipo?: unknown }).tipo !== 'tenant') {
        throw new Error('perfil do gestor exige TenantContext');
      }
      const criados = await db.$queryRaw<{ id: string }[]>`
        INSERT INTO profissional (salao_id, usuario_id, nome)
        SELECT u.salao_id, u.id, u.nome
          FROM usuario u
         WHERE u.id = ${ctx.usuarioId}::uuid AND u.salao_id = ${salaoId}::uuid AND u.papel = 'gestor'::papel_usuario
        ON CONFLICT (salao_id, usuario_id) DO NOTHING
        RETURNING id::text AS id`;
      if (criados.length > 0) {
        return { id: criados[0].id, resultado: 'criado' };
      }
      const existentes = await db.$queryRaw<{ id: string; ativo: boolean }[]>`
        SELECT p.id::text AS id, p.ativo
          FROM profissional p
          JOIN usuario u ON u.id = p.usuario_id
         WHERE p.salao_id = ${salaoId}::uuid AND p.usuario_id = ${ctx.usuarioId}::uuid
           AND u.papel = 'gestor'::papel_usuario
           FOR UPDATE OF p`;
      const existente = existentes[0];
      if (!existente) {
        throw new NaoEncontrado();
      }
      if (existente.ativo) {
        return { id: existente.id, resultado: 'ja_atende' };
      }
      await atualizar(ctx, existente.id, { ativo: true });
      return { id: existente.id, resultado: 'reativado' };
    },
  };
}
