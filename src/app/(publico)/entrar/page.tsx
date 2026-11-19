import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PublicLayout } from '@/components/layout/PublicLayout';
import { destinoAposLogin } from '@/server/auth/destino';
import { destinoSeJaAutenticado } from '@/server/auth/pagina';

import { entrarAcao } from './acoes';
import { FormularioEntrar } from './FormularioEntrar';

export const metadata: Metadata = { title: 'Entrar' };

type PaginaEntrarProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** /entrar (D-010 RN-20): login da equipe. Quem já tem sessão de salão válida vai para o painel. */
export default async function PaginaEntrar({ searchParams }: PaginaEntrarProps) {
  const { proximo } = await searchParams;
  const pedido = typeof proximo === 'string' ? proximo : null;
  const destino = await destinoSeJaAutenticado(pedido);
  if (destino !== null) {
    redirect(destino);
  }
  // Só repassa ao formulário um `proximo` que já é um destino válido (a ação revalida).
  const proximoValido = pedido !== null && destinoAposLogin(pedido) === pedido ? pedido : null;

  return (
    <PublicLayout>
      <h1>Entrar</h1>
      <FormularioEntrar acao={entrarAcao} proximo={proximoValido} />
    </PublicLayout>
  );
}
