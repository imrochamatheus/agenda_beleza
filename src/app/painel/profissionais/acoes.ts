'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import {
  criarProfissional,
  desativarProfissional,
  euTambemAtendo,
  editarProfissional,
  reativarProfissional,
} from '@/server/profissionais/profissionais.acao';
import { MENSAGENS_PROFISSIONAL } from '@/server/profissionais/tipos';
import type { CodigoErro } from '@/server/tenant/erros';

import type { EstadoDesativacao, EstadoEuTambemAtendo, EstadoFormularioProfissional } from './estado';

// Casca Next de /painel/profissionais (D-013 §3.6, D-16): só converte FormData → input e o resultado
// da ação (defineAcao, que lê o cookie) → estado do formulário. Não acessa repositórios. `redirect`
// é sempre chamado fora de try (R-5). Sem sessão válida → /entrar?proximo=<rota>.

/** Texto do FormData; ausente ou não texto (arquivo) → undefined. */
const texto = (v: FormDataEntryValue | null): string | undefined => (typeof v === 'string' ? v : undefined);

const TETO = { nome: 100, email: 254 } as const;

function irParaEntrar(rota: string): never {
  redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(rota)}`);
}

function mensagemDoErro(erro: Exclude<CodigoErro, 'nao_autenticado'>): string {
  return erro === 'acesso_negado' ? MENSAGENS_PROFISSIONAL.acessoNegado : MENSAGENS_PROFISSIONAL.naoEncontrado;
}

/** Só os campos conhecidos; os ausentes ficam de fora (campos extras do FormData são ignorados). */
function dadosDoFormulario(fd: FormData): { nome: string | undefined; email?: string } {
  const email = texto(fd.get('email'));
  return { nome: texto(fd.get('nome')), ...(email !== undefined && { email }) };
}

/** Valores devolvidos aos campos: aparados e cortados nos tetos (não ecoa entradas enormes). */
function valoresDe(d: { nome: string | undefined; email?: string }): EstadoFormularioProfissional['valores'] {
  return { nome: (d.nome ?? '').trim().slice(0, TETO.nome), email: (d.email ?? '').trim().slice(0, TETO.email) };
}

function rotaDoProfissional(id: unknown): string {
  return typeof id === 'string' && id !== '' ? ROTAS.profissional(id) : ROTAS.profissionais;
}

function revalidar(id: unknown): void {
  revalidatePath(ROTAS.profissionais);
  if (typeof id === 'string' && id !== '') revalidatePath(ROTAS.profissional(id));
}

/** Formulário de /painel/profissionais/novo. Sucesso → lista. */
export async function criarProfissionalAcao(
  _anterior: EstadoFormularioProfissional,
  fd: FormData,
): Promise<EstadoFormularioProfissional> {
  const dados = dadosDoFormulario(fd);
  const r = await criarProfissional(dados);
  const valores = valoresDe(dados);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') irParaEntrar(ROTAS.novoProfissional);
    return { mensagem: mensagemDoErro(r.erro), erros: {}, valores };
  }
  if (r.dados.resultado === 'invalido') {
    return { mensagem: null, erros: r.dados.erros, valores };
  }
  revalidar(undefined);
  redirect(ROTAS.profissionais);
}

/** Formulário de /painel/profissionais/[id] (id em campo oculto, revalidado no servidor). Sucesso → lista. */
export async function editarProfissionalAcao(
  _anterior: EstadoFormularioProfissional,
  fd: FormData,
): Promise<EstadoFormularioProfissional> {
  const id = texto(fd.get('id'));
  const dados = dadosDoFormulario(fd);
  const r = await editarProfissional({ id, ...dados });
  const valores = valoresDe(dados);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') irParaEntrar(rotaDoProfissional(id));
    return { mensagem: mensagemDoErro(r.erro), erros: {}, valores };
  }
  if (r.dados.resultado === 'invalido') {
    return { mensagem: null, erros: r.dados.erros, valores };
  }
  revalidar(id);
  redirect(ROTAS.profissionais);
}

/** Confirmação do diálogo "Desativar". A recusa (RN-2) volta com as reservas que bloqueiam. */
export async function desativarProfissionalAcao(id: string): Promise<EstadoDesativacao> {
  const r = await desativarProfissional({ id });
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') irParaEntrar(rotaDoProfissional(id));
    return { status: 'erro', mensagem: mensagemDoErro(r.erro) };
  }
  if (r.dados.resultado === 'recusado') {
    return { status: 'recusado', reservas: r.dados.reservas };
  }
  revalidar(id);
  return { status: 'desativado' };
}

/** Formulário "Reativar" (funciona sem JavaScript). Erro de acesso ou de existência aparece no novo render. */
export async function reativarProfissionalAcao(fd: FormData): Promise<void> {
  const id = texto(fd.get('id'));
  const r = await reativarProfissional({ id });
  if (!r.ok && r.erro === 'nao_autenticado') irParaEntrar(rotaDoProfissional(id));
  revalidar(id);
}

/** Formulário "Eu também atendo" da lista (não lê o estado anterior nem o FormData: o alvo é a sessão). */
export async function euTambemAtendoAcao(): Promise<EstadoEuTambemAtendo> {
  const r = await euTambemAtendo({});
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') irParaEntrar(ROTAS.profissionais);
    return { variante: 'erro', mensagem: mensagemDoErro(r.erro) };
  }
  if (r.dados.resultado === 'ja_atende') {
    return { variante: 'info', mensagem: MENSAGENS_PROFISSIONAL.jaAtende };
  }
  revalidar(r.dados.profissionalId);
  return { variante: 'sucesso', mensagem: MENSAGENS_PROFISSIONAL.perfilAtivado };
}
