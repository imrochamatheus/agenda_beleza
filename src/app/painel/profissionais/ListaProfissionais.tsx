import { DataList } from '@/components/ui/DataList';
import type { Coluna } from '@/components/ui/DataList';
import { EmptyState } from '@/components/ui/EmptyState';
import { ROTAS } from '@/config/navegacao';
import type { EstadoConvite, EstadoConviteVisao } from '@/server/convites/tipos';
import type { AcessoProfissional, ProfissionalVisao } from '@/server/profissionais/tipos';

const ROTULO_ACESSO: Record<AcessoProfissional, string> = {
  voce: 'Você',
  com_acesso: 'Com acesso',
  sem_acesso: 'Sem acesso',
};

/** Selo do convite (D-039 CA-16) para quem ainda não tem acesso; sem convite, só "Sem acesso". */
const ROTULO_CONVITE: Partial<Record<EstadoConvite, string>> = {
  pendente: 'convite pendente',
  expirado: 'convite expirado',
};

function colunas(convites: Readonly<Record<string, EstadoConviteVisao>>): readonly Coluna<ProfissionalVisao>[] {
  return [
    {
      chave: 'nome',
      rotulo: 'Nome',
      renderizar: (p) => <a href={ROTAS.profissional(p.id)}>{p.nome}</a>,
    },
    { chave: 'estado', rotulo: 'Estado', renderizar: (p) => (p.ativo ? 'Ativo' : 'Inativo') },
    {
      chave: 'acesso',
      rotulo: 'Acesso',
      renderizar: (p) => {
        const selo = p.acesso === 'sem_acesso' ? ROTULO_CONVITE[convites[p.id]?.estado ?? 'sem_convite'] : undefined;
        return selo ? `${ROTULO_ACESSO[p.acesso]} (${selo})` : ROTULO_ACESSO[p.acesso];
      },
    },
  ];
}

/**
 * Lista de profissionais do salão (D-013 CA-16): nome (link para a edição), estado e acesso, com o selo
 * do convite pendente ou expirado (D-039). A ordem (ativos primeiro, por nome) vem do servidor. Sem
 * estado: componente de servidor.
 */
export function ListaProfissionais({
  profissionais,
  convites = {},
}: {
  profissionais: readonly ProfissionalVisao[];
  convites?: Readonly<Record<string, EstadoConviteVisao>>;
}) {
  return (
    <DataList
      legenda="Profissionais do salão"
      legendaVisivel={false}
      colunas={colunas(convites)}
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
