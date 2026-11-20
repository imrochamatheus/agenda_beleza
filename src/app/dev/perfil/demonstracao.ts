// Salão de exemplo de /dev/perfil (D-020 §3.9). Só constantes.
import type { PerfilDTO } from '@/server/repos/tipos';

export const NOME_DEMONSTRACAO = 'Studio Exemplo';

export const PERFIL_DEMONSTRACAO: PerfilDTO = Object.freeze({
  descricao: 'Salão de bairro com atendimento sem pressa.\nCortes, escovas e coloração.',
  enderecoLogradouro: 'Rua Augusta',
  enderecoNumero: '1500',
  enderecoComplemento: 'Loja 3',
  enderecoBairro: 'Consolação',
  enderecoCidade: 'São Paulo',
  enderecoUf: 'SP',
  enderecoCep: '01304001',
  telefoneE164: '+551134567890',
  whatsappE164: '+5511987654321',
  instagram: 'studio.exemplo',
  meiosPagamento: ['dinheiro', 'pix'],
  comodidades: ['wifi'],
}) as PerfilDTO;
