import { TEXTO_CLIENTE_REMOVIDA } from '@/server/clientes/tipos';

import type { EstadoMensagem, TipoMensagem } from './tipos';

// Rótulos pt-BR da situação de envio (D-043 §0, RN-8). Client-safe: sem imports de servidor. Os códigos
// de erro só entram aqui por lista fechada; código desconhecido → sem motivo (RN-5).

type Genero = 'f' | 'm';

const TIPOS: Record<TipoMensagem, { nome: string; genero: Genero }> = {
  confirmacao: { nome: 'Confirmação', genero: 'f' },
  remarcacao: { nome: 'Remarcação', genero: 'f' },
  cancelamento: { nome: 'Cancelamento', genero: 'm' },
  convite_avaliacao: { nome: 'Convite de avaliação', genero: 'm' },
};

export const MOTIVOS = Object.freeze({
  resultado_incerto: 'Não foi possível confirmar se a mensagem foi entregue.',
  link_indisponivel: 'Link de avaliação indisponível.',
  sem_consentimento: 'A cliente não autorizou receber mensagens.',
});

const MOTIVO_ANONIMIZACAO = `${TEXTO_CLIENTE_REMOVIDA.charAt(0).toUpperCase()}${TEXTO_CLIENTE_REMOVIDA.slice(1)}; a mensagem foi cancelada.`;

const motivoDe = (codigo: string | null, permitidos: readonly (keyof typeof MOTIVOS)[]): string | null => {
  const achado = permitidos.find((p) => p === codigo);
  return achado === undefined ? null : MOTIVOS[achado];
};

export type EntradaDeRotulo = {
  tipo: TipoMensagem;
  revisao: number;
  estado: EstadoMensagem;
  erroCodigo: string | null;
};

export function rotuloDaMensagem(e: EntradaDeRotulo): { rotulo: string; motivo: string | null } {
  const { nome, genero } = TIPOS[e.tipo];
  const f = genero === 'f';
  const titulo = e.tipo === 'remarcacao' ? `${nome} ${e.revisao}` : nome;
  switch (e.estado) {
    case 'enviada':
      return { rotulo: `${titulo} ${f ? 'enviada' : 'enviado'}`, motivo: null };
    case 'falhou':
      return {
        rotulo: `Falha ao enviar ${titulo.charAt(0).toLowerCase()}${titulo.slice(1)} por WhatsApp`,
        motivo: motivoDe(e.erroCodigo, ['resultado_incerto', 'link_indisponivel']),
      };
    case 'pendente':
      return { rotulo: `${titulo} aguardando envio`, motivo: null };
    case 'enviando':
      return { rotulo: `${titulo} ${f ? 'sendo enviada' : 'sendo enviado'}`, motivo: null };
    case 'nao_enviada':
      return { rotulo: `${titulo} ${f ? 'não enviada' : 'não enviado'}`, motivo: motivoDe(e.erroCodigo, ['sem_consentimento']) };
    case 'cancelada_anonimizacao':
      return { rotulo: `${titulo} ${f ? 'não enviada' : 'não enviado'}`, motivo: MOTIVO_ANONIMIZACAO };
    case 'substituida':
      return e.erroCodigo === 'obsoleta'
        ? { rotulo: `${titulo} ${f ? 'não enviada' : 'não enviado'}: a reserva mudou antes do envio`, motivo: null }
        : { rotulo: `${titulo} ${f ? 'substituída' : 'substituído'} por remarcação posterior`, motivo: null };
  }
}
