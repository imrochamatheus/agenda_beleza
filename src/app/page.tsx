import Link from 'next/link';

import { DIAS_TESTE, PRECO_MENSAL_CENTAVOS } from '@/config/plano';
import { ROTAS } from '@/config/navegacao';
import { formatarMoeda } from '@/lib/format';
import { siteConfig } from '@/lib/site';

import estilos from './page.module.css';

const RECURSOS = [
  {
    titulo: 'Página pública do seu salão',
    texto: 'Perfil, fotos, horário de funcionamento e avaliações verificadas de quem realmente foi atendido.',
  },
  {
    titulo: 'Reserva sem cadastro',
    texto: 'Suas clientes escolhem serviço, profissional e horário pelo celular, sem criar conta.',
  },
  {
    titulo: 'Agenda sem choque de horários',
    texto: 'Cada profissional tem sua jornada e seus bloqueios, e o mesmo horário nunca é reservado duas vezes.',
  },
] as const;

export default function Home() {
  const preco = formatarMoeda(PRECO_MENSAL_CENTAVOS);
  return (
    <main className={estilos.pagina}>
      <section className={estilos.heroi} aria-labelledby="titulo-landing">
        <h1 id="titulo-landing">{siteConfig.name}</h1>
        <p className={estilos.lead}>
          A agenda online do seu salão: suas clientes reservam sozinhas e você acompanha tudo em um só lugar.
        </p>
        <div className={estilos.acoes}>
          <Link href={ROTAS.cadastro} className={estilos.primaria}>
            Criar conta do salão
          </Link>
          <Link href={ROTAS.entrar} className={estilos.secundaria}>
            Entrar
          </Link>
        </div>
      </section>

      <section aria-labelledby="titulo-recursos">
        <h2 id="titulo-recursos">Tudo o que o salão precisa para receber reservas</h2>
        <ul className={estilos.recursos}>
          {RECURSOS.map((r) => (
            <li key={r.titulo}>
              <h3>{r.titulo}</h3>
              <p>{r.texto}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="titulo-preco" className={estilos.preco}>
        <h2 id="titulo-preco">Plano único</h2>
        <p className={estilos.valor}>
          {preco}
          <span>/mês</span>
        </p>
        <p>{DIAS_TESTE} dias grátis para experimentar, sem compromisso.</p>
        <p>Sem limite de profissionais: toda a sua equipe no mesmo plano.</p>
      </section>

      <footer>
        <nav aria-label="Informações legais" className={estilos.legal}>
          <Link href={ROTAS.termos}>Termos de Uso</Link>
          <Link href={ROTAS.privacidade}>Política de Privacidade</Link>
        </nav>
      </footer>
    </main>
  );
}
