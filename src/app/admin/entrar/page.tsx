import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PublicLayout } from '@/components/layout/PublicLayout';
import { Alert } from '@/components/ui/Alert';
import { ROTAS } from '@/config/navegacao';
import { etapaDaPreSessao, obterCadastroTotp } from '@/server/auth/admin/login-admin';
import { lerTokenAdminDoCookie } from '@/server/auth/admin/pagina';
import { estadoDaSessaoAdmin } from '@/server/auth/admin/sessao-admin';

import { cadastrarTotpAcao, entrarAdminAcao, verificarTotpAcao } from './acoes';
import { FormularioAdmin } from './FormularioAdmin';
import { PassoCadastro } from './PassoCadastro';

// /admin/entrar (D-034): senha → (cadastro do TOTP | código). A etapa vem do cookie `ab_admin` no
// servidor. Sem cookie não há consulta ao banco. Dinâmica e sem cache (`no-store` no next.config).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Entrar na administração', robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PaginaAdminEntrar({ searchParams }: Props) {
  const { aviso } = await searchParams;
  const token = await lerTokenAdminDoCookie();
  const agora = new Date();
  if (token !== null && (await estadoDaSessaoAdmin(token, agora)).tipo === 'admin') {
    redirect(ROTAS.admin);
  }
  const etapa = token === null ? null : await etapaDaPreSessao(token, agora);

  if (etapa === 'cadastro') {
    const cadastro = await obterCadastroTotp(token!);
    if (cadastro.ok) {
      return (
        <PublicLayout>
          <h1>Configurar autenticador</h1>
          <PassoCadastro svg={cadastro.svg} chaveAgrupada={cadastro.chaveAgrupada} email={cadastro.email} />
          <FormularioAdmin acao={cadastrarTotpAcao} campos="codigo" rotuloBotao="Ativar e entrar" rotuloOcupado="Verificando…" />
        </PublicLayout>
      );
    }
    redirect(ROTAS.adminEntrar);
  }
  if (etapa === 'totp') {
    return (
      <PublicLayout>
        <h1>Verificação em duas etapas</h1>
        <p>Digite o código de 6 dígitos do seu aplicativo autenticador.</p>
        <FormularioAdmin acao={verificarTotpAcao} campos="codigo" rotuloBotao="Verificar" rotuloOcupado="Verificando…" />
      </PublicLayout>
    );
  }
  return (
    <PublicLayout>
      <h1>Entrar na administração</h1>
      {aviso === 'expirou' ? <Alert variante="aviso">Sua verificação expirou. Entre novamente.</Alert> : null}
      <FormularioAdmin acao={entrarAdminAcao} campos="credenciais" rotuloBotao="Continuar" rotuloOcupado="Entrando…" />
    </PublicLayout>
  );
}
