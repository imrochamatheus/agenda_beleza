import type { AssinaturaDoSalaoDTO } from '@/server/admin/assinatura-tipos';
import type { RegistroAuditoriaDTO } from '@/server/admin/auditoria-tipos';
import type { CodigoReenvio, MensagemAdminDTO, TentativaAdminDTO } from '@/server/admin/mensagens-tipos';
import type { JsonObjeto } from '@/server/auditoria/tipos';
import type { EstadoMensagem, TipoMensagem } from '@/server/mensagens/tipos';

// Dados em memória da vitrine /dev/admin-mensagens (D-045): os MESMOS componentes das páginas de /admin,
// sem banco, sessão nem rede. Nada é gravado; a ação de reenvio só decide um código fixo por mensagem.
// Telefones aparecem JÁ mascarados (o DTO nunca tem o E.164); nenhum dado real.

export const SALOES_DEMONSTRACAO = [
  { id: '11111111-1111-4111-8111-111111111111', nome: 'Studio Aurora' },
  { id: '22222222-2222-4222-8222-222222222222', nome: 'Espaço Lume de Beleza e Bem-Estar Integrado' },
  { id: '33333333-3333-4333-8333-333333333333', nome: 'Brisa Salão' },
] as const;

const TIPOS: TipoMensagem[] = ['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'];
const ESTADOS: EstadoMensagem[] = ['enviada', 'falhou', 'pendente', 'enviada', 'falhou', 'enviando', 'nao_enviada', 'cancelada_anonimizacao', 'substituida'];
const MASCARAS = ['+55 (71) 9****-1234', '+55 (11) 9****-4321', '+55 (21) ****-5566', '—'];
const T0 = Date.parse('2026-11-21T17:05:00Z');

export const idDaMensagem = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** 47 mensagens (3 páginas), da mais nova para a mais antiga; vários estados, salões e tipos. */
export const MENSAGENS_DEMONSTRACAO: MensagemAdminDTO[] = Array.from({ length: 47 }, (_, i) => {
  const n = i + 1;
  const estado = ESTADOS[i % ESTADOS.length];
  const tipo = TIPOS[i % TIPOS.length];
  const criada = new Date(T0 - i * 37 * 60_000).toISOString();
  return {
    id: idDaMensagem(n),
    salaoId: SALOES_DEMONSTRACAO[i % 3].id,
    salaoNome: SALOES_DEMONSTRACAO[i % 3].nome,
    tipo,
    revisao: tipo === 'remarcacao' || tipo === 'cancelamento' ? (i % 3) + 1 : 0,
    estado,
    erroCodigo: estado === 'falhou' ? (i % 2 === 0 ? 'resultado_incerto' : 'link_indisponivel') : null,
    paraMascarado: estado === 'cancelada_anonimizacao' ? 'Cliente removida' : MASCARAS[i % MASCARAS.length],
    criadaEm: criada,
    atualizadaEm: criada,
    enviadaEm: estado === 'enviada' ? new Date(Date.parse(criada) + 20_000).toISOString() : null,
  };
});

/** Código do PRG que a demonstração devolve para cada mensagem `falhou` (exercita os alertas). */
const CODIGOS_DE_FALHA: CodigoReenvio[] = ['ok', 'ok_fila', 'obsoleta', 'anonimizada'];
export function codigoDeDemonstracao(id: string): CodigoReenvio {
  const m = MENSAGENS_DEMONSTRACAO.find((x) => x.id === id);
  if (m === undefined) return 'inexistente';
  if (m.estado !== 'falhou') return 'recusada';
  return CODIGOS_DE_FALHA[MENSAGENS_DEMONSTRACAO.filter((x) => x.estado === 'falhou').indexOf(m) % CODIGOS_DE_FALHA.length];
}

export function tentativasDeDemonstracao(id: string): TentativaAdminDTO[] {
  const m = MENSAGENS_DEMONSTRACAO.find((x) => x.id === id);
  if (m === undefined || m.estado === 'nao_enviada' || m.estado === 'substituida') return [];
  const ini = Date.parse(m.criadaEm);
  const t = (numero: number, resultado: 'sucesso' | 'falha' | null, erro: string | null): TentativaAdminDTO => ({
    numero,
    iniciadaEm: new Date(ini + numero * 60_000).toISOString(),
    finalizadaEm: resultado === null ? null : new Date(ini + numero * 60_000 + 4_000).toISOString(),
    resultado,
    erroCodigo: erro,
  });
  if (m.estado === 'enviada') return [t(1, 'falha', 'timeout'), t(2, 'sucesso', null)];
  if (m.estado === 'falhou') return [t(1, 'falha', m.erroCodigo)];
  return [t(1, null, null)];
}

const ACOES_AUD = ['salao.suspender', 'mensagem.reenviar', 'salao.atualizar', 'login.sucesso', 'login.falha_senha', 'salao.reativar'];

/** Valor de ~16 KB para provar que nada estoura a largura da página (R-3). */
const GRANDE = 'valor-longo-'.repeat(1400);

/** 25 registros de auditoria (2 páginas); um com antes/depois de 16 KB e chave comprida, um com e-mail longo. */
export const AUDITORIA_DEMONSTRACAO: RegistroAuditoriaDTO[] = Array.from({ length: 25 }, (_, i) => {
  const acao = ACOES_AUD[i % ACOES_AUD.length];
  const semSalao = acao.startsWith('login');
  const sal = SALOES_DEMONSTRACAO[i % 3];
  const comDiff = !semSalao;
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    acao,
    entidade: acao.split('.')[0],
    resultado: acao === 'login.falha_senha' ? 'falha' : 'sucesso',
    ocorridoEm: new Date(Date.parse('2026-11-22T12:12:00Z') - i * 3_600_000).toISOString(),
    atorEmail: i === 3 ? 'administradora.da.plataforma.com.nome.bastante.comprido@dominio-de-demonstracao.com.br' : acao === 'login.falha_senha' ? 'quem.tentou@exemplo.com.br' : acao === 'login.sucesso' ? null : 'admin@plataforma.com.br',
    salaoId: semSalao ? null : sal.id,
    salaoNome: semSalao ? null : sal.nome,
    antes: (!comDiff ? null : i === 1 ? { estado: 'falhou' } : i === 2 ? { [`chave_${'muito_longa_'.repeat(12)}`]: GRANDE, nome: 'Antigo' } : { suspenso: false, motivo: '<b>não vira HTML</b>' }) as JsonObjeto | null,
    depois: (!comDiff ? null : i === 1 ? { estado: 'pendente', tipo: 'confirmacao', revisao: 0 } : i === 2 ? { [`chave_${'muito_longa_'.repeat(12)}`]: GRANDE, nome: 'Novo' } : { suspenso: true, motivo: '<b>não vira HTML</b>' }) as JsonObjeto | null,
  };
});

export function assinaturaDeDemonstracao(vista: string): AssinaturaDoSalaoDTO | null {
  const salao = { id: SALOES_DEMONSTRACAO[0].id, nome: SALOES_DEMONSTRACAO[0].nome, fuso: 'America/Sao_Paulo' };
  if (vista === 'assinatura-vazia') return { salao, assinatura: null, transicoes: [], eventos: [], maisEventos: false };
  const base = { id: '', tipo: 'payment', resultado: 'processado', origemValida: true, erro: null, recebidoEm: '2026-11-20T10:00:00.000Z', processadoEm: '2026-11-20T10:00:02.000Z', payload: { id: 'p1', status: 'approved' } as unknown };
  return {
    salao,
    assinatura: {
      estado: 'em_carencia',
      vinculada: true,
      testeFimEm: '2026-11-01T14:00:00.000Z',
      periodoPagoAte: '2026-11-20T14:00:00.000Z',
      primeiraFalhaEm: '2026-11-21T14:00:00.000Z',
      carenciaAte: '2026-11-24T14:00:00.000Z',
      canceladaEm: null,
      acessoAte: null,
    },
    transicoes: [
      { id: 't3', de: 'ativa', para: 'em_carencia', causa: 'cobranca_falhou', ocorridaEm: '2026-11-21T14:00:00.000Z', origemEvento: true },
      { id: 't2', de: 'em_teste', para: 'ativa', causa: 'pagamento_aprovado', ocorridaEm: '2026-11-20T10:00:02.000Z', origemEvento: true },
      { id: 't1', de: null, para: 'em_teste', causa: `criada_${'com_causa_longa_'.repeat(8)}`.slice(0, 80) + '…', ocorridaEm: '2026-10-01T14:00:00.000Z', origemEvento: false },
    ],
    eventos: [
      { ...base, id: 'e3', tipo: 'subscription_preapproval', resultado: 'rejeitado', origemValida: false, erro: 'vinculo_invalido', recebidoEm: '2026-11-22T09:12:00.000Z', processadoEm: null, payload: { id: 'x', nota: '<script>alert(1)</script>', [`chave_${'longa_'.repeat(20)}`]: GRANDE } },
      { ...base, id: 'e2', resultado: 'erro', erro: 'provedor_indisponivel', recebidoEm: '2026-11-21T14:00:00.000Z', processadoEm: '2026-11-21T14:00:03.000Z' },
      { ...base, id: 'e1' },
    ],
    maisEventos: vista === 'assinatura-mais',
  };
}
