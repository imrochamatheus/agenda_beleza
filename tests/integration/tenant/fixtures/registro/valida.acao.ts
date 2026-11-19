import { defineAcao } from '@/server/tenant/define-acao';

// Fixture do CA-4: ação válida (papéis e capacidade do conjunto). Não é ação de produto.
export const acaoValida = defineAcao({ papeis: ['gestor'], capacidade: 'configurar' }, async () => 'ok');
export const outraValida = defineAcao(
  { papeis: ['gestor', 'profissional'], capacidade: 'leitura' },
  async () => 'ok',
);
