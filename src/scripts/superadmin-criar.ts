import { ErroContaNaoAdmin, ErroSuperAdminInvalido, garantirSuperAdmin } from '@/server/auth/admin/garantir-super-admin';
import { encerrarBanco } from '@/server/repos/admin';

// Script `npm run superadmin:criar` (D-034 RN-2): lê SUPERADMIN_EMAIL e SUPERADMIN_PASSWORD, cria o
// super admin se não existir e imprime só `criado` ou `existente`. Idempotente (exit 0 nas duas
// execuções). Erro → exit 1 com mensagem sem a senha nem o valor do e-mail.

async function main(): Promise<number> {
  try {
    const r = await garantirSuperAdmin({
      email: process.env.SUPERADMIN_EMAIL,
      senha: process.env.SUPERADMIN_PASSWORD,
    });
    console.log(r);
    return 0;
  } catch (e) {
    if (e instanceof ErroSuperAdminInvalido || e instanceof ErroContaNaoAdmin) {
      console.error(`superadmin:criar falhou: ${e.message}`);
    } else {
      console.error('superadmin:criar falhou: erro inesperado (verifique DATABASE_URL e as migrações)');
    }
    return 1;
  } finally {
    await encerrarBanco();
  }
}

process.exitCode = await main();
