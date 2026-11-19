import { defineAcao } from '@/server/tenant/define-acao';

// Fixture do CA-4: ação sem capacidade. O tipo de defineAcao a recusa (por isso a diretiva abaixo,
// conferida pelo typecheck); em tempo de execução ela carrega e o registro a acusa como `sem_capacidade`.
// @ts-expect-error capacidade é obrigatória (RN-6)
export const acaoSemCapacidade = defineAcao({ papeis: ['gestor'] }, async () => 'ok');
