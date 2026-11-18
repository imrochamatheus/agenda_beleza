import { defineConfig } from 'prisma/config';

// Uso local: carrega o .env se existir. O Node não sobrescreve variáveis já definidas
// no ambiente (CI e container prevalecem). Só o erro de arquivo inexistente é ignorado.
try {
  process.loadEnvFile();
} catch (erro) {
  if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') throw erro;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Sem o helper env(): ele lança PrismaConfigEnvError quando a variável falta, o que
  // quebraria `prisma generate` e `next build` sem DATABASE_URL (CA-7). O `migrate deploy`
  // sem URL falha com "Connection url is empty", que é o comportamento desejado.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
