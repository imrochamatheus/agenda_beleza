import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { obter } from '@/server/salao/configuracoes';

import { AcessoNegado } from '../_componentes/AcessoNegado';
import { AreaUsuario } from '../_componentes/AreaUsuario';

import { salvarConfiguracoesAcao, trocarSlugAcao } from './acoes';
import estilos from './Configuracoes.module.css';
import { FormularioRegras } from './FormularioRegras';
import { FormularioSlug } from './FormularioSlug';

export const metadata: Metadata = { title: 'Configurações', robots: { index: false } };

/**
 * Configurações do salão (D-017 §3.6; RN-7, RN-19): só o gestor. Dois formulários independentes (D-10):
 * dados e regras de horário; endereço público (slug) com os anteriores. D-020: links para o perfil
 * público e o horário de funcionamento. A permissão é conferida no
 * servidor antes de qualquer leitura de dados.
 */
export default async function PaginaConfiguracoes() {
  const acesso = await exigirAcessoAoPainel(ROTAS.configuracoes, ['gestor'], 'salao.configurar');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const [cfg, { nomeUsuario, nomeSalao }] = await Promise.all([obter(acesso.ctx), buscarIdentidadeDoPainel(acesso.ctx)]);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.configuracoes}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <h1>Configurações</h1>
        <nav aria-label="Outras configurações" className={estilos.outras}>
          <ul className={estilos.listaOutras}>
            <li>
              <a href={ROTAS.configuracoesPerfil}>Perfil público</a>
              <p className={estilos.ajuda}>Descrição, endereço, contatos, meios de pagamento e comodidades.</p>
            </li>
            <li>
              <a href={ROTAS.configuracoesFuncionamento}>Horário de funcionamento</a>
              <p className={estilos.ajuda}>Dias e horários em que o salão atende.</p>
            </li>
            <li>
              <a href={ROTAS.configuracoesFotos}>Fotos do salão</a>
              <p className={estilos.ajuda}>Até 12 fotos exibidas na página pública.</p>
            </li>
          </ul>
        </nav>
        <section className={estilos.secao} aria-labelledby="config-dados">
          <h2 id="config-dados">Dados e regras de horário</h2>
          <FormularioRegras acao={salvarConfiguracoesAcao} valoresIniciais={cfg.valores} fusos={cfg.fusos} />
        </section>
        <section className={estilos.secao} aria-labelledby="config-endereco">
          <h2 id="config-endereco">Endereço público</h2>
          <FormularioSlug acao={trocarSlugAcao} slugAtual={cfg.slug.atual} anteriores={cfg.slug.anteriores} />
        </section>
      </div>
    </PanelLayout>
  );
}
