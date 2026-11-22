import { FUSO_PADRAO, formatarDataHora, formatarDeslocamentoUtc } from '@/lib/format';

// Datas das telas do admin, SEMPRE por format.ts (D-045 RN-12). As telas globais (mensagens, auditoria)
// misturam salões e usam America/Sao_Paulo com o deslocamento visível; a tela do salão usa o fuso dele.

/** '21/11/2026 14:05 (UTC−03:00)' em America/Sao_Paulo. */
export function quandoGlobal(iso: string): string {
  const d = new Date(iso);
  return `${formatarDataHora(d, FUSO_PADRAO)} (${formatarDeslocamentoUtc(d, FUSO_PADRAO)})`;
}

/** '21/11/2026 14:05' no fuso do salão (o fuso é dito em texto na página). */
export function quandoNoFuso(iso: string, fuso: string): string {
  return formatarDataHora(new Date(iso), fuso);
}

/** Frase do fuso global: 'Horários em America/Sao_Paulo (UTC−03:00).' */
export function avisoDeFusoGlobal(agora: Date = new Date()): string {
  return `Horários em ${FUSO_PADRAO} (${formatarDeslocamentoUtc(agora, FUSO_PADRAO)}).`;
}
