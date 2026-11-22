// Texto da faixa de aviso do painel por estado efetivo e papel (D-038 §3.5, RN-11). Função pura: sem banco,
// sem relógio. A data sai de `formatarData` no fuso do salão (único formatador de datas, `src/lib/format.ts`).
import type { EstadoEfetivo } from '@/domain/assinatura';
import { ROTAS } from '@/config/navegacao';
import { formatarData } from '@/lib/format';
import type { PapelDeSalao } from '@/server/tenant/context';

/** `link` (D-040): só o gestor na `pendente`, para ir a /painel/assinatura. */
export type AvisoDePlano = { tipo: 'info' | 'aviso'; texto: string; link?: { rotulo: string; href: string } };

const FALE_COM_O_GESTOR = 'Fale com o gestor do salão.';

/** `null` quando não há o que avisar (em_teste, ativa, sem_assinatura). Falha fechada quanto ao papel: só o gestor vê texto de ação. */
export function avisoDoPlano(estado: EstadoEfetivo, papel: PapelDeSalao, fuso: string): AvisoDePlano | null {
  const gestor = papel === 'gestor';
  switch (estado.estado) {
    case 'pendente':
      return {
        tipo: 'aviso',
        texto: gestor
          ? 'Assinatura pendente. Você já pode configurar o salão, mas o agendamento fica indisponível até a assinatura ser ativada.'
          : 'O salão está com a assinatura pendente de regularização. O agendamento fica indisponível até a assinatura ser ativada.',
        ...(gestor ? { link: { rotulo: 'Assinar agora', href: ROTAS.assinatura } } : {}),
      };
    case 'em_carencia': {
      const ate = estado.carenciaAte !== undefined ? ` até ${formatarData(estado.carenciaAte, fuso)}` : '';
      return {
        tipo: 'aviso',
        texto: gestor
          ? `Pagamento não confirmado. Seu acesso continua normal${ate}; regularize para evitar a suspensão.`
          : `O pagamento da assinatura do salão não foi confirmado. O acesso continua normal${ate}; o salão precisa regularizar para evitar a suspensão.`,
      };
    }
    case 'cancelada': {
      const ate = estado.acessoAte !== undefined ? ` até ${formatarData(estado.acessoAte, fuso)}` : '';
      return {
        tipo: 'info',
        texto: gestor
          ? `Assinatura cancelada. Você pode usar o painel${ate}.`
          : `A assinatura do salão foi cancelada. O painel pode ser usado${ate}.`,
      };
    }
    case 'suspensa':
      return {
        tipo: 'aviso',
        texto:
          'Assinatura suspensa. O painel está somente leitura e o agendamento está indisponível. Você ainda pode cancelar reservas futuras.' +
          (gestor ? '' : ` ${FALE_COM_O_GESTOR}`),
      };
    case 'encerrada':
      return {
        tipo: 'aviso',
        texto: `Assinatura encerrada. Painel somente leitura; o agendamento está indisponível.${gestor ? '' : ` ${FALE_COM_O_GESTOR}`}`,
      };
    case 'manual':
      return {
        tipo: 'aviso',
        texto:
          'Salão suspenso pela administração. Painel somente leitura; você ainda pode cancelar reservas futuras. ' +
          (gestor ? 'Entre em contato com o suporte.' : FALE_COM_O_GESTOR),
      };
    default:
      return null;
  }
}
