import { CREDENCIAIS_DEMO, dias, h, telefoneDemo, type SalaoSpec } from './dados';

// Salão B: Ateliê Bromélia (America/Manaus, grade 30 min, intervalo 10 min). O gestor não atende.
export const SALAO_B: SalaoSpec = {
  chave: 'b',
  nome: 'Ateliê Bromélia',
  slug: 'atelie-bromelia',
  fuso: 'America/Manaus',
  gradeMin: 30,
  intervaloMin: 10,
  perfil: {
    descricao: 'Barbearia e estúdio de sobrancelhas no centro de Manaus. (Dados fictícios de demonstração.)',
    logradouro: 'Avenida Eduardo Ribeiro',
    numero: '520',
    bairro: 'Centro',
    cidade: 'Manaus',
    uf: 'AM',
    cep: '69010001',
    telefone: telefoneDemo('92', 1),
    whatsapp: telefoneDemo('92', 2),
    instagram: 'atelie.bromelia.demo',
    meiosPagamento: ['pix', 'cartao_debito', 'dinheiro'],
    comodidades: ['wifi', 'estacionamento', 'animais'],
  },
  funcionamento: dias([2, 3, 4, 5, 6], [h(9), h(18)]),
  gestor: CREDENCIAIS_DEMO.gestorB,
  servicos: [
    { chave: 'barba', nome: 'Barba', precoCentavos: 4000, duracaoMin: 30 },
    { chave: 'corte', nome: 'Corte masculino', precoCentavos: 5000, duracaoMin: 30 },
    { chave: 'sobrancelha', nome: 'Design de sobrancelha', precoCentavos: 3500, duracaoMin: 30 },
  ],
  profissionais: [
    {
      chave: 'camila',
      nome: 'Camila Reis',
      servicos: ['barba', 'corte', 'sobrancelha'],
      jornada: dias([2, 3, 4, 5, 6], [h(9), h(12)], [h(13), h(18)]),
    },
    {
      chave: 'diego',
      nome: 'Diego Alves',
      servicos: ['barba', 'corte'],
      jornada: dias([2, 3, 4, 5, 6], [h(10), h(12)], [h(14), h(18)]),
    },
  ],
  clientes: [
    { chave: 'felipe', nome: 'Felipe Andrade', telefone: telefoneDemo('92', 11) },
    { chave: 'gabriel', nome: 'Gabriel Farias', telefone: telefoneDemo('92', 12) },
    { chave: 'heloisa', nome: 'Heloísa Cunha', telefone: telefoneDemo('92', 13) },
    { chave: 'removido', nome: null, telefone: null },
  ],
  reservas: [
    { chave: 'r1', profissional: 'camila', cliente: 'felipe', dia: -18, inicioMin: h(10), servicos: ['barba', 'corte'], status: 'concluido' },
    { chave: 'r2', profissional: 'diego', cliente: 'gabriel', dia: -11, inicioMin: h(15), servicos: ['corte'], status: 'concluido' },
    { chave: 'r3', profissional: 'camila', cliente: 'removido', dia: -8, inicioMin: h(14), servicos: ['sobrancelha'], status: 'concluido' },
    { chave: 'r4', profissional: 'diego', cliente: 'heloisa', dia: -6, inicioMin: h(11), servicos: ['barba'], status: 'nao_compareceu' },
    { chave: 'r5', profissional: 'camila', cliente: 'felipe', dia: -3, inicioMin: h(16), servicos: ['corte'], status: 'cancelado' },
    { chave: 'r6', profissional: 'camila', cliente: 'gabriel', dia: 4, inicioMin: h(9), servicos: ['barba', 'sobrancelha'], status: 'confirmado' },
    { chave: 'r7', profissional: 'diego', cliente: 'heloisa', dia: 6, inicioMin: h(15), servicos: ['corte', 'barba'], status: 'confirmado' },
  ],
  avaliacoes: [
    { reserva: 'r1', nota: 5, comentario: 'Corte e barba perfeitos, voltarei com certeza.', nomeExibicao: 'Felipe A.' },
    { reserva: 'r2', nota: 4, nomeExibicao: 'Gabriel' },
    { reserva: 'r3', nota: 5 },
  ],
  bloqueios: [
    { chave: 'b1', profissional: 'diego', dia: 9, inicioMin: h(14), fimMin: h(18), motivo: 'Consulta médica' },
    { chave: 'b2', dia: 14, inicioMin: h(9), fimMin: h(12), motivo: 'Reunião da equipe' },
  ],
  fotos: 2,
  assinatura: 'ativa',
};
