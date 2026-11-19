// Erro dos adaptadores reais ainda não implementados (D-1, CA-9). O validarEnv recusa
// MP_ADAPTER=real e WHATSAPP_ADAPTER=real na inicialização; estes stubs existem para que o
// registro já aponte para o arquivo que a E6.6 e a E7.2 vão preencher.

export type ItemPendente = 'E6.6' | 'E7.2';

export class NaoImplementado extends Error {
  readonly item: ItemPendente;

  constructor(item: ItemPendente) {
    super(`Adaptador real ainda não implementado (${item}).`);
    this.name = 'NaoImplementado';
    this.item = item;
  }
}
