import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { listarFotosDoPainel } from '@/server/fotos/leitura';
import { ehCodigoAcao, ehCodigoEnvio } from '@/server/fotos/tipos';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../_componentes/AreaUsuario';

import { editarAltAcao, moverAcao, removerAcao } from './acoes';
import { resultadoDaAcao, resultadoDoEnvio, TEXTOS_FOTOS } from './estado';
import { FormularioEnvio } from './FormularioEnvio';
import estilos from './Fotos.module.css';
import { ListaFotos } from './ListaFotos';
import { ResultadoFotos } from './Resultado';

export const metadata: Metadata = { title: 'Fotos do salão', robots: { index: false } };

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * Fotos do salão (D-021 §3.6; RN-1, RN-21): só o gestor. A permissão é conferida no servidor antes de
 * qualquer leitura. `?envio=` (resultado do route handler) e `?acao=` (PRG das ações) são lidos por
 * listas fechadas: um valor desconhecido não mostra nada. O token de envio é novo a cada renderização.
 */
export default async function PaginaFotos({ searchParams }: Props) {
  const acesso = await exigirAcessoAoPainel(ROTAS.configuracoesFotos, ['gestor'], 'salao.configurar');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const [fotos, { nomeUsuario, nomeSalao }] = await Promise.all([listarFotosDoPainel(acesso.ctx), buscarIdentidadeDoPainel(acesso.ctx)]);
  const parametros = (await searchParams) ?? {};
  const envio = ehCodigoEnvio(parametros.envio) ? parametros.envio : null;
  const acao = ehCodigoAcao(parametros.acao) ? parametros.acao : null;
  // O resultado vai ao alerta focado do topo; o erro de campo também fica ligado ao próprio campo.
  const resultado = envio !== null ? resultadoDoEnvio(envio) : acao !== null ? resultadoDaAcao(acao) : null;
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.configuracoesFotos}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <p className={estilos.voltar}>
          <a href={ROTAS.configuracoes}>Voltar para Configurações</a>
        </p>
        <h1>Fotos do salão</h1>
        {resultado ? <ResultadoFotos variante={resultado.variante} texto={resultado.texto} /> : null}
        <section className={estilos.secao} aria-labelledby="fotos-enviar">
          <h2 id="fotos-enviar">Enviar foto</h2>
          <p className={estilos.contador}>{TEXTOS_FOTOS.contador(fotos.length)}</p>
          <FormularioEnvio action={ROTAS.envioFotos} token={crypto.randomUUID()} total={fotos.length} codigo={envio} />
        </section>
        <section className={estilos.secao} aria-labelledby="fotos-lista">
          <h2 id="fotos-lista">Fotos enviadas</h2>
          <ListaFotos fotos={fotos} acoes={{ alt: editarAltAcao, mover: moverAcao, remover: removerAcao }} />
        </section>
      </div>
    </PanelLayout>
  );
}
