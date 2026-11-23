import { formatarTelefone } from '@/lib/format';
import type { ClienteVisao, ItemHistorico } from '@/server/clientes/tipos';

// Dados fixos de /dev/clientes (D-022 §3.6). Arquivo separado porque um módulo 'use server' (acoes.ts)
// só pode exportar funções assíncronas. Sem banco: a lista e a busca rodam em memória com as mesmas
// funções puras do servidor (chaveDeBusca, lerBusca, lerPagina).

export const NOME_SALAO_DEMONSTRACAO = 'Studio Exemplo';

const FIXAS: [string, string][] = [
  ['Ana Júlia', '+5511987654321'],
  ['ANA CLARA', '+5521991234567'],
  ['Zélia', '+5531988887777'],
  ['João_%', '+551134567890'],
];

/** 25 clientes: as quatro fixas e "Cliente 05" a "Cliente 25" (duas páginas de 20). */
export const CLIENTES_DEMONSTRACAO: ClienteVisao[] = [
  ...FIXAS,
  ...Array.from({ length: 21 }, (_, i): [string, string] => [`Cliente ${String(i + 5).padStart(2, '0')}`, `+55119${String(70_000_000 + i + 5)}`]),
].map(([nome, telefone], i) => ({
  id: `demo-${i + 1}`,
  nome,
  telefone,
  telefoneFormatado: formatarTelefone(telefone),
  anonimizada: false,
}));

/** Telefone que a ação de demonstração trata como "de outra cliente" (CA-11). */
export const TELEFONE_EM_USO_DEMONSTRACAO = '+5511900000002';
export const CLIENTE_EXISTENTE_DEMONSTRACAO = { id: 'demo-existente', nome: 'Yara Demonstração' };

export const CLIENTE_DETALHE_DEMONSTRACAO = { nome: 'Maria Souza', telefone: '+5511987654321' };

/** D-050: uma reserva de dois serviços com profissionais diferentes (um cancelado) e uma toda cancelada. */
export const HISTORICO_DEMONSTRACAO: ItemHistorico[] = [
  {
    id: 'h1',
    inicioLocal: '12/07/2027 09:00',
    status: 'Confirmado',
    servicos: [
      { servico: 'Corte feminino', profissional: 'Beatriz', horaLocal: '09:00', status: 'Confirmado', cancelado: false, preco: 'R$ 80,00' },
      { servico: 'Escova', profissional: 'Carla', horaLocal: '14:00', status: 'Cancelado', cancelado: true, preco: 'R$ 65,00' },
    ],
    precoTotal: 'R$ 80,00',
    totalDaCancelada: false,
  },
  {
    id: 'h2',
    inicioLocal: '10/05/2027 10:00',
    status: 'Cancelado',
    servicos: [
      { servico: 'Coloração', profissional: 'Carla', horaLocal: '10:00', status: 'Cancelado', cancelado: true, preco: 'R$ 180,00' },
    ],
    precoTotal: 'R$ 180,00',
    totalDaCancelada: true,
  },
];
