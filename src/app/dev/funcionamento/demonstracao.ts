// Salão de exemplo de /dev/funcionamento (D-020 §3.9). Só constantes.
import type { Funcionamento } from '@/server/salao/funcionamento-tipos';
import { montarSemana } from '@/server/semana/montagem';

export const NOME_DEMONSTRACAO = 'Studio Exemplo';

/** Segunda a sexta 09:00–19:00, sábado 09:00–14:00, domingo fechado. */
export const FUNCIONAMENTO_DEMONSTRACAO: Funcionamento = {
  definido: true,
  semana: montarSemana([
    ...[1, 2, 3, 4, 5].map((diaSemana) => ({ diaSemana, inicioMin: 540, fimMin: 1140 })),
    { diaSemana: 6, inicioMin: 540, fimMin: 840 },
  ]),
};

/** Todos os dias fechados (`?modo=fechado`). */
export const FUNCIONAMENTO_FECHADO: Funcionamento = { definido: true, semana: montarSemana([]) };
