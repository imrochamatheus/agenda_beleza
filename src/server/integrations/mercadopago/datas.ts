// Aritmética de datas do MP simulado (RN-17). Pura e em UTC: não há horário de verão em UTC, e a
// conversão para o fuso do salão fica na borda (E6.3).

const DIA_MS = 86_400_000;

/** `d` + `n` dias de 24 h exatas (UTC). */
export function somarDias(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DIA_MS);
}

/**
 * Mesmo dia do mês civil seguinte (UTC), com a hora preservada. Quando o mês seguinte não tem o
 * dia, usa o último dia dele (31/jan → 28 ou 29/fev; 31/mar → 30/abr). Regra documentada (R-10).
 */
export function somarUmMes(d: Date): Date {
  const ano = d.getUTCFullYear();
  const mes = d.getUTCMonth() + 1;
  // Dia 0 do mês seguinte ao alvo = último dia do mês alvo.
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      ano,
      mes,
      Math.min(d.getUTCDate(), ultimoDia),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}
