// Complemento do E2E (D-036 T-2): salões extras, NUNCA chamados pelo CLI do seed. Mutações do E2E ficam
// aqui para não tocar nos salões A e B (que os demais testes só leem). Puro: só especificações.
import { dias, h, telefoneDemo, type SalaoSpec } from './dados';

/** Quantos salões de reserva isolados existem (um por spec/teste que cria reservas). */
export const SALOES_E2E_RESERVAS = 8;
export const SLUG_E2E_SUSPENSO = 'e2e-suspenso';
export const slugE2eReservas = (n: number): string => `e2e-reservas-${n}`;

const TODOS = [0, 1, 2, 3, 4, 5, 6];

function base(chave: string, nome: string, slug: string): Omit<SalaoSpec, 'servicos' | 'profissionais' | 'suspenso'> {
  return {
    chave,
    nome,
    slug,
    fuso: 'America/Sao_Paulo',
    gradeMin: 15,
    intervaloMin: 0,
    perfil: {
      descricao: 'Salão de uso exclusivo dos testes de ponta a ponta. (Dados fictícios.)',
      logradouro: 'Rua de Teste',
      numero: '10',
      bairro: 'Centro',
      cidade: 'São Paulo',
      uf: 'SP',
      cep: '01001000',
      telefone: telefoneDemo('11', 3),
      whatsapp: telefoneDemo('11', 4),
      instagram: 'salao.e2e',
      meiosPagamento: ['pix'],
      comodidades: ['wifi'],
    },
    funcionamento: null,
    gestor: { email: `gestor@${slug}.example`, nome: 'Gestora de Teste' },
    clientes: [
      { chave: 'c1', nome: 'Paula Teste', telefone: telefoneDemo('11', 21) },
      { chave: 'c2', nome: 'Renata Teste', telefone: telefoneDemo('11', 22) },
    ],
    reservas: [
      { chave: 'r1', profissional: 'ana', cliente: 'c1', dia: -40, inicioMin: h(10), servicos: ['corte'], status: 'concluido' },
      { chave: 'r2', profissional: 'ana', cliente: 'c2', dia: -35, inicioMin: h(10), servicos: ['escova'], status: 'concluido' },
    ],
    avaliacoes: [
      { reserva: 'r1', nota: 5, comentario: 'Ótimo atendimento.', nomeExibicao: 'Paula T.' },
      { reserva: 'r2', nota: 4, nomeExibicao: 'Renata' },
    ],
    bloqueios: [],
    fotos: 2,
    assinatura: null,
  };
}

const SERVICOS = [
  { chave: 'corte', nome: 'Corte', precoCentavos: 9000, duracaoMin: 60 },
  { chave: 'escova', nome: 'Escova', precoCentavos: 5500, duracaoMin: 30 },
  { chave: 'hidratacao', nome: 'Hidratação', precoCentavos: 8000, duracaoMin: 45 },
] as const;

/** Corte + Escova: Ana e Bia. Corte + Hidratação: só Ana. Hidratação: Ana e Cris (vínculos parciais). */
const jornadaLarga = dias(TODOS, [h(8), h(12)], [h(13), h(20)]);
const PROFISSIONAIS = [
  { chave: 'ana', nome: 'Ana', servicos: ['corte', 'escova', 'hidratacao'], jornada: jornadaLarga },
  { chave: 'bia', nome: 'Bia', servicos: ['corte', 'escova'], jornada: jornadaLarga },
  { chave: 'cris', nome: 'Cris', servicos: ['hidratacao'], jornada: jornadaLarga },
] as const;

export function salaoE2eReservas(n: number): SalaoSpec {
  const slug = slugE2eReservas(n);
  return { ...base(`e2e-r${n}`, `Salão E2E ${n}`, slug), servicos: SERVICOS, profissionais: PROFISSIONAIS };
}

/** Salão suspenso manualmente (`suspenso_manual_em`): só leitura, sem formulário de reserva. */
export function salaoE2eSuspenso(): SalaoSpec {
  return {
    ...base('e2e-suspenso', 'Salão E2E Suspenso', SLUG_E2E_SUSPENSO),
    servicos: SERVICOS,
    profissionais: [PROFISSIONAIS[0]],
    fotos: 1,
    suspenso: true,
  };
}
