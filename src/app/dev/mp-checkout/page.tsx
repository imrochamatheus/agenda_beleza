import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';

import { carregarCheckoutSimulado } from '@/server/integrations/mercadopago/checkout-simulado';

// Página do checkout do Mercado Pago SIMULADO (RN-20, CA-19). Imita a página do provedor: não usa
// sessão e não pede dado de cartão. Só existe com MP_ADAPTER=simulado (senão 404, sem banco).
// O ambiente é lido na requisição: a rota nunca é pré-renderizada no build.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Checkout simulado · Agenda Beleza',
  robots: { index: false, follow: false },
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const ESTADO_DESCRITO = { autorizada: 'já foi autorizada', cancelada: 'foi cancelada' } as const;

// Tons terrosos; o contorno de foco padrão do navegador é preservado (nenhum `outline: none`).
const estilos = {
  main: {
    maxWidth: '28rem',
    margin: '0 auto',
    padding: '3rem 1.5rem',
    fontFamily: 'system-ui, sans-serif',
    color: '#3b2f2a',
    lineHeight: 1.6,
  },
  titulo: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 400, fontSize: '1.75rem' },
  valor: { fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '2rem', margin: '0.5rem 0 0' },
  aviso: { background: '#f3ebe3', padding: '0.75rem 1rem', borderRadius: '0.5rem', fontSize: '0.9rem' },
  acoes: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '2rem' },
  primario: {
    background: '#7a5c4a',
    color: '#fffaf5',
    border: '1px solid #7a5c4a',
    borderRadius: '0.5rem',
    padding: '0.75rem 1.25rem',
    fontSize: '1rem',
    cursor: 'pointer',
  },
  secundario: {
    background: 'transparent',
    color: '#5a4436',
    border: '1px solid #b9a493',
    borderRadius: '0.5rem',
    padding: '0.75rem 1.25rem',
    fontSize: '1rem',
    cursor: 'pointer',
  },
} satisfies Record<string, CSSProperties>;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CheckoutSimulado({ searchParams }: Props) {
  const { assinatura } = await searchParams;
  const dados = await carregarCheckoutSimulado(typeof assinatura === 'string' ? assinatura : undefined);
  if (!dados) notFound();

  const pendente = dados.estado === 'pendente';

  return (
    <main style={estilos.main}>
      <h1 style={estilos.titulo}>Assinatura Agenda Beleza</h1>
      <p style={estilos.valor}>
        {BRL.format(dados.valorCentavos / 100)}
        <span style={{ fontSize: '1rem' }}> por mês</span>
      </p>
      <p>{`${dados.diasTeste} dias grátis. A primeira cobrança acontece depois do período de teste.`}</p>
      <p style={estilos.aviso}>Ambiente simulado: nenhum dado de cartão é pedido.</p>
      {dados.estado !== 'pendente' && (
        <p role="status">{`Esta assinatura ${ESTADO_DESCRITO[dados.estado]}.`}</p>
      )}

      <form method="post" action="/dev/mp-checkout/decisao">
        <input type="hidden" name="assinatura" value={dados.assinaturaId} />
        <div style={estilos.acoes}>
          {pendente && (
            <button type="submit" name="decisao" value="autorizar" autoFocus style={estilos.primario}>
              Autorizar assinatura
            </button>
          )}
          <button
            type="submit"
            name="decisao"
            value="desistir"
            autoFocus={!pendente}
            style={pendente ? estilos.secundario : estilos.primario}
          >
            {pendente ? 'Desistir' : 'Voltar ao Agenda Beleza'}
          </button>
        </div>
      </form>
    </main>
  );
}
