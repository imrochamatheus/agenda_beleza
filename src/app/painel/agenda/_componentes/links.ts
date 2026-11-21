import type { AgendaVista, Visao } from '@/server/agenda/tipos';

/** Link GET da agenda (RN-13): só parâmetros presentes entram; `base` é a rota (real ou da vitrine). */
export function hrefAgenda(base: string, p: { data?: string; visao?: Visao; profissional?: string | null }): string {
  const q = new URLSearchParams();
  if (p.data) q.set('data', p.data);
  if (p.visao) q.set('visao', p.visao);
  if (p.profissional) q.set('profissional', p.profissional);
  const texto = q.toString();
  return texto === '' ? base : `${base}?${texto}`;
}

/**
 * Link "Nova reserva" (D-029 CA-15): `base` é a rota do formulário (real ou da vitrine). Leva a data da vista e
 * o profissional da vista: o filtro do gestor ou, sem filtro, a única coluna (o profissional só vê a própria).
 */
export function hrefNovaReserva(base: string, vista: Pick<AgendaVista, 'data' | 'profissionalFiltro' | 'colunas' | 'profissionais'>): string {
  const unica = vista.profissionais.length === 0 && vista.colunas.length === 1 ? vista.colunas[0].id : null;
  const q = new URLSearchParams({ data: vista.data });
  const profissional = vista.profissionalFiltro ?? unica;
  if (profissional) q.set('profissional', profissional);
  return `${base}?${q.toString()}`;
}
