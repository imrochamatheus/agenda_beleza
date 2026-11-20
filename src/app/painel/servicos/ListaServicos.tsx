import { DataList } from '@/components/ui/DataList';
import type { Coluna } from '@/components/ui/DataList';
import { EmptyState } from '@/components/ui/EmptyState';
import { ROTAS } from '@/config/navegacao';
import { formatarDuracao, formatarMoeda } from '@/lib/format';
import { MENSAGENS_SERVICO } from '@/server/servicos/tipos';
import type { ServicoResumo } from '@/server/servicos/tipos';

import estilos from './Servicos.module.css';

const COLUNAS: readonly Coluna<ServicoResumo>[] = [
  {
    chave: 'nome',
    rotulo: 'Nome',
    renderizar: (s) => <a href={ROTAS.servico(s.id)}>{s.nome}</a>,
  },
  { chave: 'preco', rotulo: 'Preço', renderizar: (s) => formatarMoeda(s.precoCentavos) },
  { chave: 'duracao', rotulo: 'Duração', renderizar: (s) => formatarDuracao(s.duracaoMin) },
  {
    chave: 'situacao',
    rotulo: 'Situação',
    renderizar: (s) =>
      s.ativo && !s.ofertavel ? (
        <>
          Ativo <span className={estilos.aviso}>{MENSAGENS_SERVICO.semProfissional}</span>
        </>
      ) : s.ativo ? (
        'Ativo'
      ) : (
        'Inativo'
      ),
  },
  { chave: 'profissionais', rotulo: 'Profissionais ativos', renderizar: (s) => String(s.profissionaisAtivos) },
];

/**
 * Lista de serviços do salão (D-014 CA-14): nome (link para a edição), preço, duração, situação e
 * quantidade de profissionais ativos. Serviço ativo sem profissional ativo traz o aviso de que não
 * aparece na página pública. A ordem (ativos primeiro, por nome) vem do servidor. Componente de servidor.
 */
export function ListaServicos({ servicos }: { servicos: readonly ServicoResumo[] }) {
  return (
    <DataList
      legenda="Serviços do salão"
      legendaVisivel={false}
      colunas={COLUNAS}
      linhas={servicos}
      chaveDaLinha={(s) => s.id}
      vazio={
        <EmptyState
          titulo="Nenhum serviço cadastrado"
          descricao="Cadastre os serviços do salão, com preço e duração, e escolha quem executa cada um."
          acao={<a href={ROTAS.novoServico}>Cadastrar serviço</a>}
        />
      }
    />
  );
}
