import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { obter } from '@/server/clientes/servico';
import { MENSAGENS_CLIENTE } from '@/server/clientes/tipos';
import type { DetalheCliente } from '@/server/clientes/tipos';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../_componentes/AreaUsuario';
import { editarClienteAcao } from '../acoes';
import estilos from '../Clientes.module.css';
import { FormularioCliente } from '../FormularioCliente';
import { HistoricoCliente } from '../HistoricoCliente';

export const metadata: Metadata = { title: 'Cliente', robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

/**
 * Detalhe da cliente (D-022 §3.6; RN-4, RN-10, RN-15): dados, edição e histórico. Ordem: 403 (profissional,
 * "Acesso negado") → 404 (outro salão, inexistente ou id que não é UUID). A cliente anonimizada aparece
 * como "Cliente removida", com o histórico e sem formulário. notFound() fica fora do try.
 */
export default async function PaginaCliente({ params }: Props) {
  const { id } = await params;
  const acesso = await exigirAcessoAoPainel(ROTAS.cliente(id), ['gestor'], 'cliente.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  let detalhe: DetalheCliente | null = null;
  try {
    detalhe = await obter(acesso.ctx, id);
  } catch (e) {
    if (!(e instanceof NaoEncontrado)) throw e;
  }
  if (detalhe === null) {
    notFound();
  }
  const { nomeUsuario, nomeSalao } = await buscarIdentidadeDoPainel(acesso.ctx);
  const { cliente, historico, totalReservas } = detalhe;
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.cliente(id)}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <h1>{cliente.nome ?? MENSAGENS_CLIENTE.removida}</h1>
        <p>
          <a href={ROTAS.clientes} className={estilos.link}>
            Voltar para clientes
          </a>
        </p>
        {cliente.anonimizada ? (
          <p>Os dados de contato desta cliente foram removidos. O histórico de agendamentos foi mantido.</p>
        ) : (
          <section className={estilos.secao} aria-labelledby="cliente-dados">
            <h2 id="cliente-dados">Dados</h2>
            <FormularioCliente
              acao={editarClienteAcao}
              id={cliente.id}
              valoresIniciais={{ nome: cliente.nome ?? '', telefone: cliente.telefoneFormatado ?? '' }}
            />
          </section>
        )}
        <HistoricoCliente itens={historico} total={totalReservas} />
      </div>
    </PanelLayout>
  );
}
