// Nome de exibição (D-032 RN-8): primeiro nome + inicial do último sobrenome com ponto ("Maria S.").
// Puro. NFC, inicial por code point (emoji e acento inteiros). Nome único: só o nome.

const LIMITE = 100;

export function nomeDeExibicao(nome: string | null | undefined): string | null {
  if (typeof nome !== 'string') return null;
  const partes = nome.normalize('NFC').split(/\s+/).filter((p) => p !== '');
  if (partes.length === 0) return null;
  const primeiro = partes[0];
  const resultado =
    partes.length === 1 ? primeiro : `${primeiro} ${Array.from(partes[partes.length - 1])[0].toLocaleUpperCase('pt-BR')}.`;
  return Array.from(resultado).slice(0, LIMITE).join('');
}
