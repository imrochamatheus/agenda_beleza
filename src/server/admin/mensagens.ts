import { mascararTelefone } from '@/lib/format';
import { TEXTO_CLIENTE_REMOVIDA } from '@/server/clientes/tipos';
import { registrarAuditoria } from '@/server/auditoria/registrar';
import { contextoDeSistema, exigirAdmin } from '@/server/tenant/context';
import type { AdminContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';
import { enfileirarReenvio, reenviarNoRepos } from '@/server/mensagens/reenviar';
import type { DependenciasEnfileirar } from '@/server/mensagens/enfileirar';
import type { EstadoMensagem, TipoMensagem } from '@/server/mensagens/tipos';
import {
  lerMensagemDaFila,
  listarFila,
  listarTentativas,
  salaoDaMensagem,
} from '@/server/repos/admin-mensagens';
import type { LinhaDaFila } from '@/server/repos/admin-mensagens';
import { ehUuid } from '@/server/repos/ids';
import { emTransacao } from '@/server/repos/transacao';

import { montarFiltroDeSalao } from './filtro-salao';
import type { ListaMensagens, MensagemAdminDTO, ResultadoReenvioAdmin, TentativaAdminDTO } from './mensagens-tipos';
import { lerFiltrosMensagens } from './mensagens-validacao';
import { LIMITE_SELECT_SALOES, deslocamentoDaPagina, totalDePaginas } from './paginacao';
import type { Consulta } from './paginacao';
import { codigoDeErroMostravel } from './rotulos-admin';

// Fila global de mensagens no painel do super admin (D-045). Sem next/*, sem 'use server', sem Prisma.
// Leituras NÃO auditam (RN-3). A máscara do telefone é aplicada aqui: o repositório entrega o E.164 só a
// este módulo e o DTO não o carrega (RN-2, R-4). O reenvio é a ÚNICA escrita (RN-6).

const ORIGEM = 'admin-mensagens';
const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** '+55 (71) 9****-1234' | 'Cliente removida' | '—'. Cliente anonimizada nunca mostra dígito. */
export function destinatarioMascarado(l: Pick<LinhaDaFila, 'clienteAnonimizada' | 'destinatarioE164'>): string {
  return l.clienteAnonimizada ? TEXTO_CLIENTE_REMOVIDA.charAt(0).toUpperCase() + TEXTO_CLIENTE_REMOVIDA.slice(1) : mascararTelefone(l.destinatarioE164);
}

export function paraDTO(l: LinhaDaFila): MensagemAdminDTO {
  return {
    id: l.id,
    salaoId: l.salaoId,
    salaoNome: l.salaoNome,
    tipo: l.tipo as TipoMensagem,
    revisao: l.revisao,
    estado: l.estado as EstadoMensagem,
    erroCodigo: codigoDeErroMostravel(l.erroCodigo),
    paraMascarado: destinatarioMascarado(l),
    criadaEm: l.criadaEm.toISOString(),
    atualizadaEm: l.atualizadaEm.toISOString(),
    enviadaEm: iso(l.enviadaEm),
  };
}

export type DepsListagem = { limiteSelectSaloes?: number };

export async function listarMensagens(ctx: AdminContext, sp: Consulta, deps: DepsListagem = {}): Promise<ListaMensagens> {
  exigirAdmin(ctx);
  const { filtros, ignorados } = lerFiltrosMensagens(sp);
  const [{ itens, total }, salao] = await Promise.all([
    listarFila(filtros, deslocamentoDaPagina(filtros.pagina)),
    montarFiltroDeSalao(deps.limiteSelectSaloes ?? LIMITE_SELECT_SALOES),
  ]);
  return { itens: itens.map(paraDTO), total, pagina: filtros.pagina, paginas: totalDePaginas(total), filtros, ignorados, salao };
}

/** Mensagem + tentativas em ordem de `numero`. Id malformado ou inexistente → NaoEncontrado (CA-10). */
export async function detalheDeTentativas(
  ctx: AdminContext,
  id: unknown,
): Promise<{ mensagem: MensagemAdminDTO; tentativas: TentativaAdminDTO[] }> {
  exigirAdmin(ctx);
  if (!ehUuid(id)) throw new NaoEncontrado();
  const linha = await lerMensagemDaFila(id);
  if (linha === null) throw new NaoEncontrado();
  const tentativas = await listarTentativas(id);
  return {
    mensagem: paraDTO(linha),
    tentativas: tentativas.map((t) => ({
      numero: t.numero,
      iniciadaEm: t.iniciadaEm.toISOString(),
      finalizadaEm: iso(t.finalizadaEm),
      resultado: t.resultado === 'sucesso' || t.resultado === 'falha' ? t.resultado : null,
      erroCodigo: codigoDeErroMostravel(t.erroCodigo),
    })),
  };
}

/** Mensagem para a etapa de confirmação; `null` se malformada, inexistente ou que não está mais `falhou`. */
export async function confirmacaoDeReenvio(ctx: AdminContext, id: unknown): Promise<MensagemAdminDTO | null> {
  exigirAdmin(ctx);
  if (!ehUuid(id)) return null;
  const linha = await lerMensagemDaFila(id);
  return linha === null || linha.estado !== 'falhou' ? null : paraDTO(linha);
}

export type DepsReenvio = DependenciasEnfileirar & {
  /** Só testes: substitui a auditoria (para forçar a falha e provar o desfazer). */
  auditar?: typeof registrarAuditoria;
};

/**
 * Reenvia uma mensagem `falhou` (RN-5/6/7). Uma transação: `mensagem FOR UPDATE` → `falhou → pendente` →
 * auditoria `mensagem.reenviar`; só DEPOIS do commit enfileira com a chave `reserva:tipo:revisao`. O salão vem
 * da própria linha (nunca do formulário). Id malformado ou inexistente → NaoEncontrado (igual). Recusa pura
 * (`nao_falhou`, `obsoleta`) não grava nada; `cliente_anonimizada` muda a linha e por isso é auditado. O
 * adaptador só é chamado pelo worker. Permitido em salão suspenso (RN-8).
 */
export async function reenviarMensagemAdmin(
  ctx: AdminContext,
  mensagemId: unknown,
  agora: Date,
  deps: DepsReenvio = {},
): Promise<ResultadoReenvioAdmin> {
  exigirAdmin(ctx);
  if (!ehUuid(mensagemId)) throw new NaoEncontrado();
  const salaoId = await salaoDaMensagem(mensagemId);
  if (salaoId === null) throw new NaoEncontrado();
  const sctx = contextoDeSistema(salaoId, ORIGEM);
  const auditar = deps.auditar ?? registrarAuditoria;
  const r = await emTransacao(async (repos) => {
    const x = await reenviarNoRepos(repos, sctx, mensagemId, agora);
    if (x.resultado === 'reenfileirada') {
      await auditar(
        ctx,
        {
          acao: 'mensagem.reenviar',
          entidade: 'mensagem',
          entidadeId: mensagemId,
          salaoId,
          antes: { estado: 'falhou' },
          depois: { estado: 'pendente', tipo: x.tipo, revisao: x.revisao },
        },
        repos,
      );
    } else if (x.motivo === 'cliente_anonimizada') {
      await auditar(
        ctx,
        {
          acao: 'mensagem.reenviar',
          entidade: 'mensagem',
          entidadeId: mensagemId,
          salaoId,
          antes: { estado: 'falhou' },
          depois: { estado: 'cancelada_anonimizacao' },
        },
        repos,
      );
    }
    return x;
  });
  if (r.resultado === 'recusada') return r;
  const e = await enfileirarReenvio(r, deps);
  return { resultado: 'reenfileirada', mensagemId: e.mensagemId, filaIndisponivel: e.filaIndisponivel };
}
