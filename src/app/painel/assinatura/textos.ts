import { DIAS_TESTE, PRECO_MENSAL_CENTAVOS } from '@/config/plano';
import type { SituacaoOperacional } from '@/domain/assinatura';
import { formatarData, formatarMoeda } from '@/lib/format';
import type { DatasDaTela } from '@/server/assinatura/tela-tipos';

// Textos pt-BR da tela da assinatura (D-042 web-design §5). Nenhum literal de data ou valor: datas só por
// `formatarData(d, fuso do salão)`, valor por `formatarMoeda(PRECO_MENSAL_CENTAVOS)`, prazo por DIAS_TESTE.

export type LinhaDeDado = { rotulo: string; valor: string; destaque: boolean };

export type TextosDoEstado = { frase: string; apoio: string | null; linhas: LinhaDeDado[] };

export const precoPorMes = (): string => `${formatarMoeda(PRECO_MENSAL_CENTAVOS)}/mês`;

const LINHA_PLANO = (): LinhaDeDado => ({ rotulo: 'Plano', valor: precoPorMes(), destaque: false });

export function textosDoEstado(estado: SituacaoOperacional, datas: DatasDaTela, fuso: string): TextosDoEstado {
  const d = (x: Date | undefined) => (x === undefined ? null : formatarData(x, fuso));
  const plano = LINHA_PLANO();
  switch (estado) {
    case 'sem_assinatura':
      return {
        frase: 'Você ainda não assinou.',
        apoio: `Teste por ${DIAS_TESTE} dias e depois ${precoPorMes()}.`,
        linhas: [plano],
      };
    case 'pendente':
      return {
        frase: 'Assinatura pendente de autorização.',
        apoio: 'Assinatura pendente de autorização no provedor. O agendamento fica indisponível até lá.',
        linhas: [plano],
      };
    case 'em_teste': {
      const fim = d(datas.testeFimEm);
      return {
        frase: fim === null ? 'Período de teste em andamento.' : `Período de teste até ${fim}`,
        apoio: 'A primeira cobrança é nesse dia.',
        linhas: fim === null ? [plano] : [plano, { rotulo: 'Primeira cobrança', valor: fim, destaque: true }],
      };
    }
    case 'ativa': {
      const prox = d(datas.periodoPagoAte);
      return {
        frase: 'Assinatura ativa.',
        apoio: prox === null ? null : `Próxima cobrança em ${prox}.`,
        linhas: prox === null ? [plano] : [plano, { rotulo: 'Próxima cobrança', valor: prox, destaque: true }],
      };
    }
    case 'em_carencia': {
      const ate = d(datas.carenciaAte);
      return {
        frase: 'Pagamento não confirmado.',
        apoio: ate === null ? null : `Seu acesso continua até ${ate}.`,
        linhas: ate === null ? [plano] : [plano, { rotulo: 'Acesso até', valor: ate, destaque: false }],
      };
    }
    case 'suspensa':
      return { frase: 'Assinatura suspensa por falta de pagamento.', apoio: 'Painel somente leitura.', linhas: [plano] };
    case 'cancelada': {
      const ate = d(datas.acessoAte);
      return {
        frase: 'Assinatura cancelada.',
        apoio: ate === null ? null : `Você pode usar o painel até ${ate}.`,
        linhas: ate === null ? [plano] : [plano, { rotulo: 'Acesso até', valor: ate, destaque: false }],
      };
    }
    case 'encerrada':
      return { frase: 'Assinatura encerrada.', apoio: 'Painel somente leitura.', linhas: [plano] };
    default:
      return {
        frase: 'Salão suspenso pela administração.',
        apoio: 'Entre em contato com o suporte.',
        linhas: [plano],
      };
  }
}

/** Aviso da etapa 2 do cancelamento (o que acontece); `null` quando o estado não permite cancelar. */
export function textoDoCancelamento(estado: SituacaoOperacional, datas: DatasDaTela, fuso: string): string | null {
  switch (estado) {
    case 'em_teste': {
      const fim = datas.testeFimEm === undefined ? 'o fim do período de teste' : formatarData(datas.testeFimEm, fuso);
      return `Se cancelar, você mantém o acesso até ${fim} e não será cobrada.`;
    }
    case 'ativa': {
      const pago = datas.periodoPagoAte === undefined ? 'o fim do período pago' : formatarData(datas.periodoPagoAte, fuso);
      return `Se cancelar, você mantém o acesso até ${pago} (período já pago). Não haverá nova cobrança.`;
    }
    case 'pendente':
      return 'Se cancelar, a assinatura é encerrada agora.';
    case 'em_carencia':
    case 'suspensa':
      return 'Se cancelar, a assinatura é encerrada agora e o painel fica somente leitura.';
    default:
      return null;
  }
}

export const ROTULOS_DAS_ACOES = {
  assinar: { texto: 'Assinar', ocupado: 'Abrindo o checkout…' },
  continuar: { texto: 'Continuar assinatura', ocupado: 'Abrindo o checkout…' },
  assinar_novamente: { texto: 'Assinar novamente', ocupado: 'Abrindo o checkout…' },
  regularizar: { texto: 'Regularizar pagamento', ocupado: 'Abrindo o provedor…' },
  atualizar: { texto: 'Atualizar meio de pagamento', ocupado: 'Abrindo o provedor…' },
} as const;
