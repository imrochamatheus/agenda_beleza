// Dados fixos do salão de exemplo de /dev/configuracoes (D-017 §3.7). Arquivo separado porque um módulo
// 'use server' (acoes.ts) só pode exportar funções assíncronas.
export const FUSO_DEMONSTRACAO = 'America/Sao_Paulo';
/** `?fuso=alias`: fuso gravado fora da lista (RN-9, spec §6). */
export const FUSO_ALIAS_DEMONSTRACAO = 'Brazil/East';
export const NOME_DEMONSTRACAO = 'Studio Exemplo';
export const SLUG_ATUAL_DEMONSTRACAO = 'studio-exemplo';
/** Histórico do próprio salão: aceito na troca (D-8). */
export const SLUG_ANTERIOR_DEMONSTRACAO = 'studio-antigo';
/** Simula o slug de outro salão. */
export const SLUG_EM_USO_DEMONSTRACAO = 'em-uso';
