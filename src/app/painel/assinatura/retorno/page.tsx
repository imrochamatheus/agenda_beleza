import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { Alert } from '@/components/ui/Alert';
import { ROTAS } from '@/config/navegacao';
import { consultarRetorno } from '@/server/assinatura/retorno';
import { mensagemDeRetorno } from '@/server/assinatura/iniciar-tipos';
import type { ResultadoRetorno } from '@/server/assinatura/iniciar-tipos';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../_componentes/AreaUsuario';
import estilos from '../Assinatura.module.css';

export const metadata: Metadata = { title: 'Retorno da assinatura', robots: { index: false } };
export const dynamic = 'force-dynamic';

const VARIANTE: Record<ResultadoRetorno, 'sucesso' | 'info' | 'aviso'> = {
  teste_iniciado: 'sucesso',
  ja_em_teste: 'info',
  aguardando: 'info',
  cancelada_no_provedor: 'aviso',
  sem_assinatura: 'aviso',
  indisponivel: 'aviso',
  vinculo_invalido: 'aviso',
  neutro: 'info',
};

/**
 * Retorno do checkout (D-040 RN-6): IGNORA a query string. O navegador só dispara a consulta ao
 * provedor; só uma autorização confirmada por ele inicia o teste. Efeito idempotente, sem PRG.
 */
export default async function PaginaRetornoAssinatura() {
  const acesso = await exigirAcessoAoPainel(ROTAS.assinaturaRetorno, ['gestor'], 'assinatura.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const [resultado, { nomeUsuario, nomeSalao }] = await Promise.all([
    consultarRetorno(acesso.ctx, new Date()),
    buscarIdentidadeDoPainel(acesso.ctx),
  ]);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.assinatura}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <h1>Assinatura</h1>
        <Alert variante={VARIANTE[resultado]}>{mensagemDeRetorno(resultado)}</Alert>
        <p>
          <a href={ROTAS.assinatura}>Ir para a assinatura</a>
        </p>
      </div>
    </PanelLayout>
  );
}
