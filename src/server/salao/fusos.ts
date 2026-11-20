import { ehFusoCanonico, fusosCanonicos } from '@/server/tempo/fuso';

import type { OpcaoFuso, OpcoesFuso } from './tipos';

// Opções do <select> de fuso (D-017 §3.4; RN-9, RN-19, D-25). Servidor: usa a lista do runtime. Os
// formulários recebem as opções prontas por prop.

/** Os 16 fusos do Brasil com rótulo pt-BR: São Paulo primeiro e os demais por rótulo (D-25). */
export const FUSOS_BRASIL: readonly OpcaoFuso[] = Object.freeze(
  [
    ['America/Sao_Paulo', 'Brasília e São Paulo'],
    ['America/Araguaina', 'Araguaína'],
    ['America/Belem', 'Belém'],
    ['America/Boa_Vista', 'Boa Vista'],
    ['America/Campo_Grande', 'Campo Grande'],
    ['America/Cuiaba', 'Cuiabá'],
    ['America/Eirunepe', 'Eirunepé'],
    ['America/Noronha', 'Fernando de Noronha'],
    ['America/Fortaleza', 'Fortaleza'],
    ['America/Maceio', 'Maceió'],
    ['America/Manaus', 'Manaus'],
    ['America/Porto_Velho', 'Porto Velho'],
    ['America/Recife', 'Recife'],
    ['America/Rio_Branco', 'Rio Branco'],
    ['America/Bahia', 'Salvador'],
    ['America/Santarem', 'Santarém'],
  ].map(([valor, cidade]) => Object.freeze({ valor, rotulo: `${cidade} (${valor})` })),
);

const VALORES_BRASIL: ReadonlySet<string> = new Set(FUSOS_BRASIL.map((f) => f.valor));

/**
 * brasil = FUSOS_BRASIL ∩ lista do runtime (na ordem da constante); outros = canônicos fora do Brasil,
 * na ordem do ICU, com rótulo = valor; atualForaDaLista = { valor, rotulo: "<valor> (atual)" } quando o
 * fuso gravado não é canônico (RN-9, spec §6).
 */
export function opcoesDeFuso(fusoAtual: string | null): OpcoesFuso {
  const brasil = FUSOS_BRASIL.filter((f) => ehFusoCanonico(f.valor)).map((f) => ({ ...f }));
  const outros = fusosCanonicos()
    .filter((v) => !VALORES_BRASIL.has(v))
    .map((v) => ({ valor: v, rotulo: v }));
  const atualForaDaLista =
    fusoAtual !== null && fusoAtual !== '' && !ehFusoCanonico(fusoAtual) ? { valor: fusoAtual, rotulo: `${fusoAtual} (atual)` } : null;
  return { atualForaDaLista, brasil, outros };
}
