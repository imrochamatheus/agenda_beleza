'use server';

import { LIMITES_CADASTRO, MENSAGENS_CADASTRO, cadastrar } from '@/server/auth/cadastro';

import type { EstadoCadastro } from './estado';

// Casca Next do cadastro (D-011 §3.6). Fora de *.acao.ts: cadastro é pré-autenticação (como o
// login). Sem redirect e sem cookie: o sucesso troca o formulário pelo aviso "Verifique seu e-mail".

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

/** Ação do formulário de /cadastro. A senha nunca volta no estado. */
export async function cadastrarAcao(_anterior: EstadoCadastro, formData: FormData): Promise<EstadoCadastro> {
  const nome = texto(formData.get('nome'));
  const email = texto(formData.get('email'));
  const nomeSalao = texto(formData.get('nomeSalao'));
  const r = await cadastrar({ nome, email, senha: texto(formData.get('senha')), nomeSalao });

  // Valores devolvidos aos campos: aparados e cortados nos tetos (não ecoa entradas enormes).
  const valores = {
    nome: nome.trim().slice(0, LIMITES_CADASTRO.nome.max),
    email: email.trim().slice(0, LIMITES_CADASTRO.email.max),
    nomeSalao: nomeSalao.trim().slice(0, LIMITES_CADASTRO.nomeSalao.max),
  };
  const base: EstadoCadastro = {
    status: 'editando',
    mensagem: null,
    emailExistente: false,
    erros: {},
    valores,
    avisoEnvio: null,
  };

  if (r.ok) {
    return {
      ...base,
      status: 'sucesso',
      valores: { ...valores, email: r.email },
      avisoEnvio: r.envio === 'falhou' ? MENSAGENS_CADASTRO.avisoEnvio : null,
    };
  }
  switch (r.motivo) {
    case 'validacao':
      return { ...base, erros: r.erros };
    case 'email_existente':
      return { ...base, mensagem: r.erros.email, emailExistente: true, erros: r.erros };
    default:
      return { ...base, mensagem: r.mensagem };
  }
}
