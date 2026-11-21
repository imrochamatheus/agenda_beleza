// Soma de um mês civil em UTC (D-037 RN-6): mesmo horário, dia limitado ao último dia do mês de destino.
// Só getters/Date.UTC em UTC; o resultado não depende do fuso do processo.

export function somarUmMesCivilUtc(d: Date): Date {
  const ano = d.getUTCFullYear();
  const mes = d.getUTCMonth() + 1;
  const ultimoDiaDestino = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d.getUTCDate(), ultimoDiaDestino);
  return new Date(
    Date.UTC(ano, mes, dia, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()),
  );
}
