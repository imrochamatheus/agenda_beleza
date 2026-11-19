import { defineAcao } from '@/server/tenant/define-acao';

// Fixture do CA-4: capacidade fora do conjunto CAPACIDADES (acusada como `capacidade_invalida`).
// @ts-expect-error 'apagar_tudo' não é Capacidade
export const acaoCapacidadeInvalida = defineAcao({ papeis: ['gestor'], capacidade: 'apagar_tudo' }, async () => 'ok');
