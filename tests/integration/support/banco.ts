/** Nome da base de uma URL do PostgreSQL: o caminho sem a "/" inicial, sem query nem fragmento. */
export function nomeDaBase(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/**
 * URL do banco dos testes de integração. Os testes usam só TEST_DATABASE_URL, nunca
 * DATABASE_URL (RN-9). Sem a variável, o teste falha (não é pulado; S-5).
 *
 * A guarda compara o NOME DA BASE, e não o texto da URL (ajuste A-3 do DBA):
 * localhost x 127.0.0.1 ou um `?schema=` a mais apontam para a mesma base de desenvolvimento.
 * É a mesma regra do script de initdb (docker/postgres/initdb/10-base-de-teste.sh).
 */
export function urlBancoDeTeste(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL não definida: suba o PostgreSQL (docker compose up -d postgres) e configure o .env',
    );
  }
  const urlDev = process.env.DATABASE_URL;
  if (urlDev && nomeDaBase(url) === nomeDaBase(urlDev)) {
    throw new Error(
      'TEST_DATABASE_URL aponta para a mesma base de DATABASE_URL: os testes de integração exigem uma base separada',
    );
  }
  return url;
}
