import type { Visao } from '@/server/agenda/tipos';

/** Link GET da agenda (RN-13): só parâmetros presentes entram; `base` é a rota (real ou da vitrine). */
export function hrefAgenda(base: string, p: { data?: string; visao?: Visao; profissional?: string | null }): string {
  const q = new URLSearchParams();
  if (p.data) q.set('data', p.data);
  if (p.visao) q.set('visao', p.visao);
  if (p.profissional) q.set('profissional', p.profissional);
  const texto = q.toString();
  return texto === '' ? base : `${base}?${texto}`;
}
