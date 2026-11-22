import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { confirmacaoDeReenvio, detalheDeTentativas, listarMensagens } from '@/server/admin/mensagens';
import { lerCodigoDeReenvio } from '@/server/admin/mensagens-tipos';
import type { ListaMensagens } from '@/server/admin/mensagens-tipos';
import { unico } from '@/server/admin/paginacao';
import { exigirAcessoAoAdmin } from '@/server/auth/admin/pagina';
import { ErrorState } from '@/components/ui/ErrorState';
import { ehErroDeDominio, NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../_componentes/AcessoNegado';
import { CascaAdmin } from '../_componentes/CascaAdmin';
import { TelaDeMensagens } from './_componentes/TelaDeMensagens';
import type { ConfirmacaoDeReenvio } from './_componentes/TelaDeMensagens';
import { reenviarAcao } from './acoes';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Mensagens', robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> };

/**
 * /admin/mensagens (D-045 CA-9/CA-10/CA-14): fila global, só super admin com TOTP (`exigirAcessoAoAdmin`).
 * Ler NÃO grava auditoria. `?confirmar=<id>` abre a confirmação do reenvio, `?detalhe=<id>` as tentativas (404 se
 * malformado/inexistente) e `?reenvio=` o resultado do PRG (lista fechada).
 */
export default async function PaginaDeMensagens({ searchParams }: Props) {
  const acesso = await exigirAcessoAoAdmin();
  if (acesso.tipo === 'negado') return <AcessoNegado />;
  const sp = await searchParams;
  let lista: ListaMensagens | null = null;
  let confirmacao: ConfirmacaoDeReenvio | null = null;
  let detalhe: Awaited<ReturnType<typeof detalheDeTentativas>> | null = null;
  let naoEncontrado = false;
  try {
    lista = await listarMensagens(acesso.ctx, sp);
    const idConfirmar = unico(sp.confirmar);
    if (idConfirmar !== undefined) {
      const m = await confirmacaoDeReenvio(acesso.ctx, idConfirmar);
      confirmacao = m === null ? { indisponivel: true } : { mensagem: m };
    }
    const idDetalhe = unico(sp.detalhe);
    if (idDetalhe !== undefined) detalhe = await detalheDeTentativas(acesso.ctx, idDetalhe);
  } catch (e) {
    if (e instanceof NaoEncontrado) naoEncontrado = true;
    else if (ehErroDeDominio(e)) throw e;
    else {
      console.error(JSON.stringify({ evento: 'admin.mensagens.leitura_falhou' }));
      lista = null;
    }
  }
  if (naoEncontrado) notFound();
  return (
    <CascaAdmin caminhoAtual={ROTAS.adminMensagens}>
      <h1>Mensagens</h1>
      {lista === null ? (
        <ErrorState
          titulo="Não foi possível carregar as mensagens."
          saida={<a href={ROTAS.adminMensagens}>Tentar novamente</a>}
        />
      ) : (
        <TelaDeMensagens
          lista={lista}
          base={ROTAS.adminMensagens}
          hrefDoSalao={ROTAS.adminSalao}
          reenvio={lerCodigoDeReenvio(unico(sp.reenvio))}
          confirmacao={confirmacao}
          detalhe={detalhe}
          acaoReenviar={reenviarAcao}
        />
      )}
    </CascaAdmin>
  );
}
