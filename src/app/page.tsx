import { siteConfig } from '@/lib/site';

export default function Home() {
  return (
    <main>
      <h1>{siteConfig.name}</h1>
      <p>Em breve: agende seu horário no salão de forma simples e rápida.</p>
    </main>
  );
}
