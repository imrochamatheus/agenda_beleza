import type { DetalheSalao, LinhaSalao } from '@/server/admin/saloes-tipos';
import type { AtualDoSalao } from '@/server/admin/saloes-validacao';

// Dados em memória da vitrine /dev/admin-saloes (D-044 CA-14): os MESMOS componentes das páginas de /admin,
// sem banco, sessão nem rede. Nada é gravado; as ações só rodam a validação PURA do servidor.

export const FIM_DO_TESTE_DEMONSTRACAO = '2030-11-30T17:00:00.000Z';
export const ID_DEMONSTRACAO = '11111111-1111-4111-8111-111111111111';

const base = { gradeMin: 15, antecedenciaMin: 120, janelaDias: 60, intervaloMin: 0, fuso: 'America/Sao_Paulo' };

const ESTADOS: LinhaSalao['estado'][] = ['em_teste', 'ativa', 'pendente', 'em_carencia', 'suspensa', 'cancelada', null];

/** 23 salões: duas páginas; estados variados; um e-mail e um endereço longos; dois suspensos manualmente. */
export const SALOES_DEMONSTRACAO: LinhaSalao[] = Array.from({ length: 23 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  const longo = i === 2;
  return {
    id: i === 0 ? ID_DEMONSTRACAO : `00000000-0000-4000-8000-${String(i + 2).padStart(12, '0')}`,
    nome: i === 0 ? 'Studio Aurora' : longo ? 'Espaço Lume de Beleza e Bem-Estar Integrado' : `Salão de demonstração ${n}`,
    slug: i === 0 ? 'aurora' : longo ? 'espaco-lume-de-beleza-e-bem-estar-integrado-centro-historico' : `demo-${n}`,
    estado: i === 0 ? 'em_teste' : ESTADOS[i % ESTADOS.length],
    suspenso: i === 1 || i === 4,
    gestorEmail: longo ? 'gestora.com.nome.bastante.comprido@dominio-de-demonstracao.com.br' : `gestor${n}@exemplo.com.br`,
  };
});

export function detalheDeDemonstracao(vista: string): DetalheSalao {
  const comum: DetalheSalao = {
    id: ID_DEMONSTRACAO,
    nome: 'Studio Aurora',
    slug: 'aurora',
    ...base,
    suspensoEm: null,
    gestor: { nome: 'Ana Gestora', email: 'ana@exemplo.com.br', confirmado: true },
    assinatura: { estado: 'em_teste', testeFimEm: FIM_DO_TESTE_DEMONSTRACAO, vinculada: true },
  };
  if (vista === 'detalhe-suspenso') return { ...comum, suspensoEm: '2030-11-20T12:12:00.000Z', assinatura: { estado: 'suspensa', testeFimEm: null, vinculada: true } };
  if (vista === 'detalhe-sem-assinatura') return { ...comum, assinatura: null };
  if (vista === 'detalhe-ativa') return { ...comum, assinatura: { estado: 'ativa', testeFimEm: null, vinculada: true } };
  return comum;
}

export const ATUAL_DEMONSTRACAO: AtualDoSalao = {
  nome: 'Studio Aurora',
  slug: 'aurora',
  fuso: base.fuso,
  gradeMin: base.gradeMin,
  antecedenciaMin: base.antecedenciaMin,
  janelaDias: base.janelaDias,
  intervaloMin: base.intervaloMin,
  gestor: { nome: 'Ana Gestora', email: 'ana@exemplo.com.br' },
};

export const SLUG_EM_USO_DEMONSTRACAO = 'ocupado';
export const EMAIL_EM_USO_DEMONSTRACAO = 'ocupado@exemplo.com.br';
/** Dias que disparam cada resultado do provedor na demonstração. */
export const DIAS_PROVEDOR_FALHA = '13';
export const DIAS_MUDOU = '14';
export const DIAS_DIVERGENCIA = '15';
