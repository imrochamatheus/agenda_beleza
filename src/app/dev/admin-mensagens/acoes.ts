'use server';

import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { hrefDaFila, lerFiltrosMensagens } from '@/server/admin/mensagens-validacao';
import { vitrineHabilitada } from '@/server/env';

import { codigoDeDemonstracao } from './demonstracao';

// Ação de demonstração de /dev/admin-mensagens (D-045 CA-14): não grava nada, não chama o servidor de verdade.
// Devolve um código FIXO por mensagem pelo mesmo PRG (`?reenvio=`) da tela real, para o E2E exercitar cada
// alerta. Vitrine desligada: não faz nada. `redirect` lança: fora de try.

const texto = (v: FormDataEntryValue | null): string | undefined => (typeof v === 'string' ? v : undefined);

export async function demonstrarReenvioAcao(fd: FormData): Promise<void> {
  if (!vitrineHabilitada(process.env)) return;
  const { filtros } = lerFiltrosMensagens({
    estado: texto(fd.get('estado')),
    tipo: texto(fd.get('tipo')),
    salao: texto(fd.get('salao')),
    pagina: texto(fd.get('pagina')),
  });
  const codigo = codigoDeDemonstracao(texto(fd.get('mensagemId')) ?? '');
  redirect(hrefDaFila(ROTAS.devAdminMensagens, filtros, filtros.pagina, { reenvio: codigo }));
}
