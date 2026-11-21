import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FormularioAdmin } from '@/app/admin/entrar/FormularioAdmin';
import { PassoCadastro } from '@/app/admin/entrar/PassoCadastro';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { gerarQrSvg } from '@/server/auth/admin/qr';
import { agruparChave, uriOtpauth } from '@/server/auth/admin/totp';
import { vitrineHabilitada } from '@/server/env';

import { demonstrarCodigoAcao, demonstrarCredenciaisAcao } from './acoes';

// Demonstração do login do super admin para o E2E sem banco (D-034 §2): os MESMOS componentes de
// /admin/entrar, com ações que só validam. 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido
// na requisição. `?vista=senha|codigo|cadastro` (padrão: senha).
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Login do admin (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Segredo FIXO e público, só da demonstração (nunca vale em login real). */
const SEGREDO_DEMO = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoAdminEntrar({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const { vista } = await searchParams;
  if (vista === 'cadastro') {
    return (
      <PublicLayout>
        <h1>Configurar autenticador</h1>
        <PassoCadastro
          svg={gerarQrSvg(uriOtpauth('admin@exemplo.test', SEGREDO_DEMO), 'QR code para o aplicativo autenticador')}
          chaveAgrupada={agruparChave(SEGREDO_DEMO)}
          email="admin@exemplo.test"
        />
        <FormularioAdmin acao={demonstrarCodigoAcao} campos="codigo" rotuloBotao="Ativar e entrar" rotuloOcupado="Verificando…" />
      </PublicLayout>
    );
  }
  if (vista === 'codigo') {
    return (
      <PublicLayout>
        <h1>Verificação em duas etapas</h1>
        <p>Digite o código de 6 dígitos do seu aplicativo autenticador.</p>
        <FormularioAdmin acao={demonstrarCodigoAcao} campos="codigo" rotuloBotao="Verificar" rotuloOcupado="Verificando…" />
      </PublicLayout>
    );
  }
  return (
    <PublicLayout>
      <h1>Entrar na administração</h1>
      <FormularioAdmin acao={demonstrarCredenciaisAcao} campos="credenciais" rotuloBotao="Continuar" rotuloOcupado="Entrando…" />
    </PublicLayout>
  );
}
