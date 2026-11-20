'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { criarServico, desativarServico, editarServico, reativarServico } from '@/server/servicos/servicos.acao';
import { LIMITES_SERVICO, MENSAGENS_SERVICO } from '@/server/servicos/tipos';
import type { ResultadoSalvarServico, ResultadoSituacaoServico } from '@/server/servicos/tipos';
import type { ResultadoAcao } from '@/server/tenant/define-acao';
import type { CodigoErro } from '@/server/tenant/erros';

import type { EstadoFormularioServico, EstadoSituacao, ValoresFormularioServico } from './estado';

// Casca Next de /painel/servicos (D-014 §3.6): só converte FormData → input e o resultado da ação
// (defineAcao, que lê o cookie) → estado do formulário. Não acessa repositórios. `redirect` é sempre
// chamado fora de try. Sem sessão válida → /entrar?proximo=<rota>.

/** Texto do FormData; ausente ou não texto (arquivo) → undefined. */
const texto = (v: FormDataEntryValue | null): string | undefined => (typeof v === 'string' ? v : undefined);

type DadosFormulario = { nome: string | undefined; preco: string | undefined; duracao: string | undefined; profissionais: string[] };

function irParaEntrar(rota: string): never {
  redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(rota)}`);
}

function mensagemDoErro(erro: Exclude<CodigoErro, 'nao_autenticado'>): string {
  return erro === 'acesso_negado' ? MENSAGENS_SERVICO.acessoNegado : MENSAGENS_SERVICO.naoEncontrado;
}

/**
 * Só os campos conhecidos (extras ignorados). As caixas desmarcadas não chegam no FormData: nenhuma
 * marcada → `profissionais: []` (D-16, R-5), o que remove os vínculos com profissionais ativos.
 */
function dadosDoFormulario(fd: FormData): DadosFormulario {
  return {
    nome: texto(fd.get('nome')),
    preco: texto(fd.get('preco')),
    duracao: texto(fd.get('duracao')),
    profissionais: fd.getAll('profissionais').filter((v): v is string => typeof v === 'string'),
  };
}

/** Valores devolvidos aos campos: aparados e cortados nos tetos (não ecoa entradas enormes). */
function valoresDe(d: DadosFormulario): ValoresFormularioServico {
  return {
    nome: (d.nome ?? '').trim().slice(0, LIMITES_SERVICO.nome.max),
    preco: (d.preco ?? '').trim().slice(0, LIMITES_SERVICO.precoMaxCaracteres),
    duracao: (d.duracao ?? '').trim().slice(0, 4),
    profissionais: d.profissionais.slice(0, LIMITES_SERVICO.profissionaisMax),
  };
}

function rotaDoServico(id: unknown): string {
  return typeof id === 'string' && id !== '' ? ROTAS.servico(id) : ROTAS.servicos;
}

function revalidar(id: unknown): void {
  revalidatePath(ROTAS.servicos);
  if (typeof id === 'string' && id !== '') revalidatePath(ROTAS.servico(id));
}

/** Resultado de criar/editar → estado; sucesso → revalida e vai para a lista (fora de try). */
function aplicarSalvar(
  r: ResultadoAcao<ResultadoSalvarServico>,
  dados: DadosFormulario,
  rota: string,
  id: unknown,
): EstadoFormularioServico {
  const valores = valoresDe(dados);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') irParaEntrar(rota);
    return { mensagem: mensagemDoErro(r.erro), erros: {}, valores };
  }
  if (r.dados.resultado === 'invalido') {
    return { mensagem: null, erros: r.dados.erros, valores };
  }
  revalidar(id);
  redirect(ROTAS.servicos);
}

/** Formulário de /painel/servicos/novo. Sucesso → lista. */
export async function criarServicoAcao(_anterior: EstadoFormularioServico, fd: FormData): Promise<EstadoFormularioServico> {
  const dados = dadosDoFormulario(fd);
  return aplicarSalvar(await criarServico(dados), dados, ROTAS.novoServico, undefined);
}

/** Formulário de /painel/servicos/[id] (id em campo oculto, revalidado no servidor). Sucesso → lista. */
export async function editarServicoAcao(_anterior: EstadoFormularioServico, fd: FormData): Promise<EstadoFormularioServico> {
  const id = texto(fd.get('id'));
  const dados = dadosDoFormulario(fd);
  return aplicarSalvar(await editarServico({ id, ...dados }), dados, rotaDoServico(id), id);
}

/** Resultado de desativar/reativar → estado com a mensagem (D-9). */
function aplicarSituacao(r: ResultadoAcao<ResultadoSituacaoServico>, id: unknown): EstadoSituacao {
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') irParaEntrar(rotaDoServico(id));
    return { variante: 'erro', mensagem: mensagemDoErro(r.erro) };
  }
  revalidar(id);
  if (r.dados.resultado === 'desativado') {
    return { variante: 'sucesso', mensagem: MENSAGENS_SERVICO.desativado };
  }
  return {
    variante: 'sucesso',
    mensagem: r.dados.ofertavel
      ? MENSAGENS_SERVICO.reativado
      : `${MENSAGENS_SERVICO.reativado} ${MENSAGENS_SERVICO.semProfissional}`,
  };
}

/** Formulário "Desativar serviço" (funciona sem JavaScript). */
export async function desativarServicoAcao(_anterior: EstadoSituacao, fd: FormData): Promise<EstadoSituacao> {
  const id = texto(fd.get('id'));
  return aplicarSituacao(await desativarServico({ id }), id);
}

/** Formulário "Reativar serviço" (funciona sem JavaScript). */
export async function reativarServicoAcao(_anterior: EstadoSituacao, fd: FormData): Promise<EstadoSituacao> {
  const id = texto(fd.get('id'));
  return aplicarSituacao(await reativarServico({ id }), id);
}
