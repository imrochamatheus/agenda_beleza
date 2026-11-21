// Estado e textos da página de fotos (D-021 §3.6). Só tipos e constantes client-safe: é importado por
// componentes cliente e pela casca. Os códigos de envio (?envio=) e de ação (?acao=) são listas fechadas.
import { LIMITES_FOTO, MENSAGENS_ACAO, MENSAGENS_FOTO } from '@/server/fotos/tipos';
import type { CodigoAcao, CodigoEnvio } from '@/server/fotos/tipos';

/** Mensagem do resultado do envio (?envio=) e se é sucesso ou erro. */
export function resultadoDoEnvio(codigo: CodigoEnvio): { variante: 'sucesso' | 'erro'; texto: string } {
  return { variante: codigo === 'ok' ? 'sucesso' : 'erro', texto: MENSAGENS_FOTO[codigo] };
}

/** Mensagem do resultado de uma ação sobre a lista (?acao=). */
export function resultadoDaAcao(codigo: CodigoAcao): { variante: 'sucesso' | 'aviso' | 'erro'; texto: string } {
  const sucesso: readonly CodigoAcao[] = ['alt_ok', 'movida', 'removida'];
  const aviso: readonly CodigoAcao[] = ['ordem_mudou', 'na_ponta'];
  const variante = sucesso.includes(codigo) ? 'sucesso' : aviso.includes(codigo) ? 'aviso' : 'erro';
  return { variante, texto: MENSAGENS_ACAO[codigo] };
}

/** Campo do formulário de envio a que o erro pertence (aria-describedby); o resto vai ao alerta geral. */
export function campoDoErro(codigo: CodigoEnvio | null): 'foto' | 'alt' | null {
  switch (codigo) {
    case 'sem_arquivo':
    case 'tamanho':
    case 'tipo':
    case 'ilegivel':
    case 'resolucao':
      return 'foto';
    case 'alt_vazio':
    case 'alt_longo':
      return 'alt';
    default:
      return null;
  }
}

export const ID_FORM_ENVIO = 'envio-foto';
export const ID_CAMPO_FOTO = 'foto-arquivo';
export const ID_CAMPO_ALT = 'foto-alt';

export const TEXTOS_FOTOS = Object.freeze({
  contador: (n: number) => `${n} de ${LIMITES_FOTO.maxFotos} fotos`,
  limiteAtingido: MENSAGENS_FOTO.limite,
  privacidade:
    'As fotos ficam públicas na página do salão. Antes de salvar, removemos os metadados da imagem, inclusive a localização (GPS).',
  ajudaArquivo: 'JPEG, PNG ou WebP, até 5 MB. A foto é reduzida para no máximo 1600 pixels no maior lado.',
  ajudaAlt: 'Descreva o que aparece na foto. Esse texto é lido por quem usa leitor de tela. Até 150 caracteres.',
  vazio: 'O salão ainda não tem fotos.',
});

/** Nome acessível dos botões de cada foto; contém o texto visível do botão (WCAG 2.5.3). */
export const nomeDoBotao = {
  cima: (n: number) => `Mover para cima: foto ${n}`,
  baixo: (n: number) => `Mover para baixo: foto ${n}`,
  remover: (n: number) => `Remover a foto ${n}`,
  salvarAlt: (n: number) => `Salvar descrição da foto ${n}`,
};
