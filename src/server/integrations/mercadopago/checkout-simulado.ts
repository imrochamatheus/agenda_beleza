import { DIAS_TESTE } from '@/config/plano';
import { modoSelecionado } from '@/server/env';
import { repoSimMercadoPago } from '@/server/repos/sim-mercadopago';

import { OperacaoInvalidaNoProvedor } from './port';
import type { EstadoAssinaturaProvedor } from './port';
import { criarMercadoPagoSimulado } from './simulado';

// Checkout do Mercado Pago simulado (RN-20, CA-19, D-007 §3.12): a lógica da página
// /dev/mp-checkout e do POST /dev/mp-checkout/decisao. O ambiente é lido na REQUISIÇÃO (nunca no
// build). Fora de MP_ADAPTER=simulado, responde "não existe" SEM tocar no banco (R-7).
// O redirecionamento usa só a urlRetorno GRAVADA em criarAssinatura: nada vindo da requisição
// entra na URL de destino além do ID já validado contra o banco (sem redirecionamento aberto).

type Fonte = Record<string, string | undefined>;

export type DadosCheckout = {
  assinaturaId: string;
  valorCentavos: number;
  diasTeste: number;
  estado: EstadoAssinaturaProvedor;
};

export type DecisaoCheckout = { status: 404 } | { status: 303; location: string };

export const DECISOES_CHECKOUT = ['autorizar', 'desistir'] as const;

const NAO_ENCONTRADO: DecisaoCheckout = { status: 404 };

const ativo = (fonte: Fonte) => modoSelecionado(fonte, 'MP_ADAPTER') === 'simulado';

/** Dados da página; `null` (→ 404) fora do modo simulado ou com ID ausente, inválido ou inexistente. */
export async function carregarCheckoutSimulado(
  id: string | undefined,
  fonte: Fonte = process.env,
): Promise<DadosCheckout | null> {
  if (!ativo(fonte) || !id) return null;
  const a = await repoSimMercadoPago().buscarAssinatura(id);
  if (!a) return null;
  return { assinaturaId: a.id, valorCentavos: a.valorCentavos, diasTeste: DIAS_TESTE, estado: a.estado };
}

/**
 * Decisão do formulário. Campos lidos: `assinatura` e `decisao` (autorizar | desistir); qualquer
 * outro (ex.: uma `urlRetorno` forjada) é ignorado. Autorizar fora de `pendente` não tem efeito e
 * só redireciona. Destino: urlRetorno gravada + `preapproval_id=<id>` (como o provedor real).
 */
export async function decidirCheckoutSimulado(
  form: FormData,
  fonte: Fonte = process.env,
): Promise<DecisaoCheckout> {
  if (!ativo(fonte)) return NAO_ENCONTRADO;
  const id = form.get('assinatura');
  const decisao = form.get('decisao');
  if (typeof id !== 'string' || !(DECISOES_CHECKOUT as readonly unknown[]).includes(decisao)) {
    return NAO_ENCONTRADO;
  }

  const a = await repoSimMercadoPago().buscarAssinatura(id);
  if (!a) return NAO_ENCONTRADO;

  if (decisao === 'autorizar') {
    // `appUrl` só compõe a urlCheckout de criarAssinatura; `autorizar` não a usa.
    const mp = criarMercadoPagoSimulado({ appUrl: fonte.APP_URL ?? '' });
    try {
      await mp.autorizar(a.id);
    } catch (erro) {
      // Já autorizada ou cancelada (inclusive por um duplo clique): sem efeito, só redireciona.
      if (!(erro instanceof OperacaoInvalidaNoProvedor)) throw erro;
    }
  }

  const destino = new URL(a.urlRetorno);
  destino.searchParams.set('preapproval_id', a.id);
  return { status: 303, location: destino.toString() };
}
