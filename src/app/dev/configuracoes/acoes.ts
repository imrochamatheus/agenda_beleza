'use server';

import { estadoRegrasInicial, estadoSlugInicial, lerFormularioRegras, lerFormularioSlug } from '@/app/painel/configuracoes/estado';
import type { EstadoRegras, EstadoSlug } from '@/app/painel/configuracoes/estado';
import { vitrineHabilitada } from '@/server/env';
import { MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';
import { normalizarSlug, validarNovoSlug, validarRegras, valoresDoSalao } from '@/server/salao/validacao';

import { FUSO_DEMONSTRACAO, SLUG_ATUAL_DEMONSTRACAO, SLUG_EM_USO_DEMONSTRACAO } from './demonstracao';

// Ações de demonstração de /dev/configuracoes (D-017 §3.7, D-26): só rodam a validação PURA do servidor,
// sem banco, sessão nem rede; nada é gravado. Desligada a vitrine, devolvem o estado anterior sem
// processar. Salão de exemplo em demonstracao.ts: igual ao atual → sem efeito; o anterior (histórico
// próprio) é aceito; SLUG_EM_USO_DEMONSTRACAO simula o slug de outro salão.

export async function demonstrarRegrasAcao(anterior: EstadoRegras, fd: FormData): Promise<EstadoRegras> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valores } = lerFormularioRegras(fd);
  const v = validarRegras(entrada, { fusoAtual: FUSO_DEMONSTRACAO });
  if (!v.ok) {
    return { mensagem: null, sucesso: null, erros: v.erros, valores };
  }
  return { ...estadoRegrasInicial(valoresDoSalao(v.regras)), sucesso: M.regrasSalvas };
}

export async function demonstrarSlugAcao(anterior: EstadoSlug, fd: FormData): Promise<EstadoSlug> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valor } = lerFormularioSlug(fd);
  const n = normalizarSlug(entrada.slug);
  if (n === SLUG_ATUAL_DEMONSTRACAO) {
    return { ...estadoSlugInicial(), sucesso: M.slugSemEfeito };
  }
  const erro = n === null ? M.slugFormato : n === SLUG_EM_USO_DEMONSTRACAO ? M.slugEmUso : validarNovoSlug(n);
  if (erro !== null) {
    return { mensagem: null, sucesso: null, erros: { slug: erro }, valor };
  }
  return { ...estadoSlugInicial(), sucesso: M.slugTrocado };
}
