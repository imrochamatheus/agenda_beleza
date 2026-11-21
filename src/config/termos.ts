/**
 * Fonte única da versão e dos textos de consentimento (D-023 RN-15, A-6). Client-safe: sem imports
 * de servidor. Mudar QUALQUER texto aqui ou em `termos-documentos.ts` exige nova `VERSAO_TERMOS`
 * e nova entrada em `HASHES_POR_VERSAO` (src/config/termos.test.ts). Nenhum outro arquivo deve
 * repetir a versão como literal.
 */
export const VERSAO_TERMOS = '2026-11-21-provisorio';

/** Data de calendário (AAAA-MM-DD), sem fuso. Exibida por `formatarDataCivil` (src/lib/format.ts). */
export const VIGENCIA_TERMOS = '2026-11-21';

export const FINALIDADES = ['mensagens_reserva', 'convite_avaliacao', 'publicacao_avaliacao'] as const;
export type Finalidade = (typeof FINALIDADES)[number];

/** Nomes fixos dos campos do formulário (RN-18); o componente e o servidor leem daqui. */
export const CAMPOS_CONSENTIMENTO = {
  mensagensReserva: 'consentimento_mensagens',
  conviteAvaliacao: 'consentimento_convite',
} as const;

/** Trecho de texto: puro, ou link para uma das páginas legais (resolvido pelo componente). */
export type ParteDeTexto = string | { readonly link: 'termos' | 'privacidade'; readonly texto: string };

export const TEXTOS_CONSENTIMENTO: Record<Finalidade, readonly ParteDeTexto[]> = {
  mensagens_reserva: [
    'Li e aceito os ',
    { link: 'termos', texto: 'Termos de Uso' },
    ' e a ',
    { link: 'privacidade', texto: 'Política de Privacidade' },
    ', e concordo em receber por WhatsApp as mensagens da minha reserva: confirmação, remarcação e cancelamento.',
  ],
  convite_avaliacao: [
    'Aceito receber, depois do atendimento, um convite por WhatsApp para avaliar o salão. Minha avaliação poderá ser publicada com meu primeiro nome e a inicial do sobrenome, conforme a ',
    { link: 'privacidade', texto: 'Política de Privacidade' },
    '.',
  ],
  publicacao_avaliacao: [
    'Autorizo a publicação da minha avaliação (nota e comentário) com meu primeiro nome e a inicial do sobrenome, conforme a ',
    { link: 'privacidade', texto: 'Política de Privacidade' },
    '.',
  ],
};
