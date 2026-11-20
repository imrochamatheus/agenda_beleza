import { DataList } from '@/components/ui/DataList';
import type { Coluna } from '@/components/ui/DataList';
import { EmptyState } from '@/components/ui/EmptyState';
import { ROTAS } from '@/config/navegacao';
import type { AcessoProfissional, ProfissionalVisao } from '@/server/profissionais/tipos';

const ROTULO_ACESSO: Record<AcessoProfissional, string> = {
  voce: 'Você',
  com_acesso: 'Com acesso',
  sem_acesso: 'Sem acesso',
};

const COLUNAS: readonly Coluna<ProfissionalVisao>[] = [
  {
    chave: 'nome',
    rotulo: 'Nome',
    renderizar: (p) => <a href={ROTAS.profissional(p.id)}>{p.nome}</a>,
  },
  { chave: 'estado', rotulo: 'Estado', renderizar: (p) => (p.ativo ? 'Ativo' : 'Inativo') },
  { chave: 'acesso', rotulo: 'Acesso', renderizar: (p) => ROTULO_ACESSO[p.acesso] },
];

/**
 * Lista de profissionais do salão (D-013 CA-16): nome (link para a edição), estado e acesso. A ordem
 * (ativos primeiro, por nome) vem do servidor. Sem estado: componente de servidor.
 */
export function ListaProfissionais({ profissionais }: { profissionais: readonly ProfissionalVisao[] }) {
  return (
    <DataList
      legenda="Profissionais do salão"
      legendaVisivel={false}
      colunas={COLUNAS}
      linhas={profissionais}
      chaveDaLinha={(p) => p.id}
      vazio={
        <EmptyState
          titulo="Nenhum profissional cadastrado"
          descricao="Cadastre quem atende no salão para montar a agenda e a página pública."
          acao={<a href={ROTAS.novoProfissional}>Cadastrar profissional</a>}
        />
      }
    />
  );
}
