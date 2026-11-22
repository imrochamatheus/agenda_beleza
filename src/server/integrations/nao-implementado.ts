// Erro dos adaptadores reais ainda não implementados (D-1, CA-9). Mercado Pago (D-046) e WhatsApp
// (D-047) já têm adaptador real; o tipo permanece para os itens pendentes e para os testes.

export type ItemPendente = 'E6.6' | 'E7.2';

export class NaoImplementado extends Error {
  readonly item: ItemPendente;

  constructor(item: ItemPendente) {
    super(`Adaptador real ainda não implementado (${item}).`);
    this.name = 'NaoImplementado';
    this.item = item;
  }
}
