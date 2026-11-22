'use server';

import { MENSAGENS_ADMIN_SALOES as M } from '@/server/admin/saloes-tipos';
import type { ResultadoExtensao } from '@/server/admin/saloes-tipos';
import { diferencaDoSalao, validarDias, validarEdicao, validarMotivo } from '@/server/admin/saloes-validacao';
import { vitrineHabilitada } from '@/server/env';
import { DIA_MS } from '@/server/admin/saloes-tipos';

import { lerEdicao, lerExtensao, lerSuspensao } from '@/app/admin/saloes/estado';
import type { EstadoEdicao, EstadoExtensao, EstadoSuspensao } from '@/app/admin/saloes/estado';

import {
  ATUAL_DEMONSTRACAO,
  DIAS_DIVERGENCIA,
  DIAS_MUDOU,
  DIAS_PROVEDOR_FALHA,
  EMAIL_EM_USO_DEMONSTRACAO,
  FIM_DO_TESTE_DEMONSTRACAO,
  SLUG_EM_USO_DEMONSTRACAO,
} from './demonstracao';

// Ações de demonstração de /dev/admin-saloes (D-044 CA-14): só rodam a validação PURA do servidor e devolvem
// resultados fixos; sem banco, sessão nem rede, nada é gravado. Desligada a vitrine, devolvem o estado
// anterior sem processar. Valores especiais: slug "ocupado" e e-mail "ocupado@exemplo.com.br" simulam
// conflito; 13, 14 e 15 dias simulam falha do provedor, "mudou" e divergência.

export async function demonstrarEdicaoAcao(anterior: EstadoEdicao, fd: FormData): Promise<EstadoEdicao> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valores } = lerEdicao(fd);
  const base = { em: Date.now(), mensagem: null, valores };
  const v = validarEdicao(entrada, ATUAL_DEMONSTRACAO);
  if (!v.ok) return { ...base, resultado: { resultado: 'invalido', erros: v.erros } };
  if (v.vazio) return { ...base, resultado: { resultado: 'sem_mudanca' } };
  if (v.mudancas.slug === SLUG_EM_USO_DEMONSTRACAO) return { ...base, resultado: { resultado: 'conflito_slug', erros: { slug: 'Este endereço já está em uso. Escolha outro.' } } };
  if (v.mudancas.gestorEmail === EMAIL_EM_USO_DEMONSTRACAO) return { ...base, resultado: { resultado: 'email_em_uso', erros: { gestorEmail: M.emailEmUso } } };
  // Só para exercitar a mesma função pura de diferença que a ação real usa.
  diferencaDoSalao(ATUAL_DEMONSTRACAO, v.mudancas);
  return { ...base, resultado: { resultado: 'editado', ...(v.mudancas.gestorEmail === null ? {} : { confirmacao: 'enviado' as const }) } };
}

export async function demonstrarSuspensaoAcao(anterior: EstadoSuspensao, fd: FormData): Promise<EstadoSuspensao> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, motivo } = lerSuspensao(fd);
  const base = { em: Date.now(), mensagem: null, valores: { motivo } };
  const m = validarMotivo(entrada.motivo);
  if (!m.ok) return { ...base, resultado: { resultado: 'invalido', erros: { motivo: m.erro } } };
  return { ...base, resultado: entrada.etapa === 'confirmar' ? { resultado: 'suspenso' } : { resultado: 'previa', motivo: m.motivo } };
}

export async function demonstrarReativacaoAcao(anterior: EstadoSuspensao, fd: FormData): Promise<EstadoSuspensao> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, motivo } = lerSuspensao(fd);
  const base = { em: Date.now(), mensagem: null, valores: { motivo } };
  if (entrada.motivo.trim() !== '') {
    const m = validarMotivo(entrada.motivo);
    if (!m.ok) return { ...base, resultado: { resultado: 'invalido', erros: { motivo: m.erro } } };
  }
  return { ...base, resultado: { resultado: 'reativado' } };
}

export async function demonstrarExtensaoAcao(anterior: EstadoExtensao, fd: FormData): Promise<EstadoExtensao> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, dias } = lerExtensao(fd);
  const base = { em: Date.now(), mensagem: null, valores: { dias } };
  const d = validarDias(entrada.dias);
  if (!d.ok) return { ...base, resultado: { resultado: 'invalido', erros: { dias: d.erro } } };
  const de = FIM_DO_TESTE_DEMONSTRACAO;
  const para = new Date(new Date(de).getTime() + d.dias * DIA_MS).toISOString();
  let resultado: ResultadoExtensao = { resultado: 'previa', de, para, dias: d.dias };
  if (entrada.etapa === 'confirmar') {
    if (entrada.dias === DIAS_PROVEDOR_FALHA) resultado = { resultado: 'provedor_falhou' };
    else if (entrada.dias === DIAS_MUDOU) resultado = { resultado: 'mudou', novoFim: new Date(new Date(de).getTime() + 2 * DIA_MS).toISOString() };
    else if (entrada.dias === DIAS_DIVERGENCIA) resultado = { resultado: 'divergencia' };
    else resultado = { resultado: 'estendido', de, para, dias: d.dias };
  }
  return { ...base, resultado };
}
