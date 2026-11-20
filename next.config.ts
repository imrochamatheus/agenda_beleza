import type { NextConfig } from 'next';

import { ROTAS } from './src/config/navegacao';

const nextConfig: NextConfig = {
  // D-011 (DEF-1/DEF-2, revisão da D-15): o link de confirmação traz o token na query. Com
  // `strict-origin`, o Referer de toda requisição feita a partir da página (CSS, fontes, scripts,
  // links) leva só a origem, sem caminho nem token, inclusive em mesma origem. Ao contrário de
  // `no-referrer`, o cabeçalho Origin dos POSTs continua normal, então o reenvio sem JS (Server
  // Action) passa pela checagem CSRF do Next. Cabeçalho HTTP (não meta): vale antes do <head>.
  async headers() {
    return [{ source: ROTAS.confirmarEmail, headers: [{ key: 'Referrer-Policy', value: 'strict-origin' }] }];
  },
};

export default nextConfig;
