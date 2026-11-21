import { formatarDataHora, formatarDuracao, formatarMoeda, formatarTelefone } from '@/lib/format';
import { exigirPermissao } from '@/server/auth/permissoes';
import { repos } from '@/server/repos';
import { ehUuid } from '@/server/repos/ids';
import { emTransacao } from '@/server/repos/transacao';
import type { Repos } from '@/server/repos';
import type { ClienteDTO, ReservaHistoricoDTO } from '@/server/repos/tipos';
import type { ContextoEscopado, TenantContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { ehViolacaoDeTelefoneUnico } from './erros-banco';
import { LIMITES_CLIENTE, ROTULO_STATUS } from './tipos';
import type {
  ClienteVisao,
  DetalheCliente,
  EntradaEditarCliente,
  EntradaUpsertCliente,
  ItemHistorico,
  ListaClientes,
  ResultadoEditarCliente,
  ResultadoUpsertCliente,
} from './tipos';
import { lerBusca, lerPagina, validarEntradaCliente } from './validacao';

// Serviço de domínio das clientes (D-022 §3.4; RN-1..RN-16). Sem next/*: as ações, as páginas e as
// E3.x/E4.2 o chamam. Só usa o salão do contexto. Log estruturado só com ids (nome e telefone NÃO vão
// para o log).

function registrar(evento: string, dados: Record<string, unknown>): void {
  console.info(JSON.stringify({ evento, ...dados }));
}

export function paraVisao(c: ClienteDTO): ClienteVisao {
  const anonimizada = c.anonimizadaEm !== null || c.nome === null || c.telefoneE164 === null;
  return {
    id: c.id,
    nome: anonimizada ? null : c.nome,
    telefone: anonimizada ? null : c.telefoneE164,
    telefoneFormatado: anonimizada || c.telefoneE164 === null ? null : formatarTelefone(c.telefoneE164),
    anonimizada,
  };
}

/**
 * ÚNICO ponto de criação de cliente (RN-6). Valida e normaliza ANTES de tocar o banco. Sem `r`, usa
 * `repos()` (um comando isolado, já atômico); com `r` (da `emTransacao` do chamador) grava na transação
 * da reserva. Nunca lança por duplicidade: o INSERT … ON CONFLICT se une à linha existente.
 */
export async function upsertCliente(
  ctx: ContextoEscopado,
  entrada: EntradaUpsertCliente,
  r?: Repos,
): Promise<ResultadoUpsertCliente> {
  const v = validarEntradaCliente({ nome: entrada?.nome, telefone: entrada?.telefone });
  if (!v.ok) {
    return { resultado: 'invalido', erros: v.erros };
  }
  const { cliente, criada } = await (r ?? repos()).clientes.upsert(ctx, { nome: v.nome, telefoneE164: v.telefoneE164 });
  registrar('cliente.upsert', { clienteId: cliente.id, criada });
  return { resultado: 'ok', cliente, criada };
}

/** RN-8/RN-9: só gestor. */
export async function listar(ctx: TenantContext, entrada: { q?: unknown; pagina?: unknown }): Promise<ListaClientes> {
  exigirPermissao(ctx, 'cliente.gerir');
  const busca = lerBusca(entrada?.q);
  const pagina = lerPagina(entrada?.pagina);
  const { itens, total } = await repos().clientes.buscar(ctx, { nome: busca.nome, digitos: busca.digitos, pagina });
  return { itens: itens.map(paraVisao), total, pagina, porPagina: LIMITES_CLIENTE.porPagina, q: busca.q };
}

function paraItemHistorico(r: ReservaHistoricoDTO, fuso: string): ItemHistorico {
  const duracao = r.itens.reduce((t, i) => t + i.duracaoMin, 0);
  const preco = r.itens.reduce((t, i) => t + i.precoCentavos, 0);
  return {
    id: r.id,
    inicioLocal: formatarDataHora(r.inicio, fuso),
    status: ROTULO_STATUS[r.status],
    profissional: r.profissionalNome,
    servicos: r.itens.map((i) => i.servicoNome),
    // Toda reserva tem itens (E3.2); sem eles (dado externo) não há duração a formatar.
    duracaoTotal: duracao > 0 ? formatarDuracao(duracao) : '—',
    precoTotal: formatarMoeda(preco),
  };
}

/** RN-15: detalhe com histórico (inclui anonimizada, RN-4). Id inválido ou de outro salão → NaoEncontrado. */
export async function obter(ctx: TenantContext, id: unknown): Promise<DetalheCliente> {
  exigirPermissao(ctx, 'cliente.gerir');
  if (!ehUuid(id)) {
    throw new NaoEncontrado();
  }
  const r = repos();
  const c = await r.clientes.buscarPorId(ctx, id);
  const [hist, fuso] = await Promise.all([
    r.clientes.historico(ctx, id, LIMITES_CLIENTE.historicoMax),
    r.bloqueios.fusoDoSalao(ctx),
  ]);
  return { cliente: paraVisao(c), historico: hist.reservas.map((x) => paraItemHistorico(x, fuso)), totalReservas: hist.total };
}

/**
 * RN-10..RN-14 (A-4): trava do salão → linha da cliente FOR UPDATE → pré-checagem do telefone → UPDATE.
 * A única captura é a do 23505 de `cliente_salao_id_telefone_e164_key` (corrida com um upsert), feita
 * FORA da transação, depois do desfazer; qualquer outro erro sobe.
 */
export async function editar(ctx: TenantContext, entrada: EntradaEditarCliente): Promise<ResultadoEditarCliente> {
  exigirPermissao(ctx, 'cliente.gerir');
  const id = entrada?.id;
  if (!ehUuid(id)) {
    throw new NaoEncontrado();
  }
  const v = validarEntradaCliente({ nome: entrada.nome, telefone: entrada.telefone });
  if (!v.ok) {
    return { resultado: 'invalido', erros: v.erros };
  }
  try {
    return await emTransacao(async (t): Promise<ResultadoEditarCliente> => {
      await t.saloes.travar(ctx);
      const g = await t.clientes.atualizar(ctx, id, { nome: v.nome, telefoneE164: v.telefoneE164 });
      if (g.resultado === 'em_uso') {
        return { resultado: 'recusado', motivo: 'telefone_em_uso', existente: g.existente };
      }
      registrar('cliente.editar', { clienteId: id, alterada: g.alterada });
      return { resultado: 'ok', cliente: paraVisao(g.cliente), alterada: g.alterada };
    });
  } catch (e) {
    if (!ehViolacaoDeTelefoneUnico(e)) throw e;
    const existente = await repos().clientes.buscarPorTelefone(ctx, v.telefoneE164);
    if (!existente) throw e;
    registrar('cliente.editar', { clienteId: id, recusado: 'telefone_em_uso' });
    return { resultado: 'recusado', motivo: 'telefone_em_uso', existente };
  }
}
