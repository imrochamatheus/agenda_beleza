import { detectarTipo } from '@/server/imagem/detectar';
import { processarImagem } from '@/server/imagem/processar';
import { validarAlt, validarEnvioToken } from '@/server/fotos/validacao';
import type { EntradaEnvio, FotoDoPainel, ResultadoEnvio } from '@/server/fotos/tipos';
import type { ResultadoAcao } from '@/server/tenant/define-acao';

// Dados e núcleo da vitrine /dev/fotos (D-021 §3.6, D-10): fotos de exemplo e o envio de demonstração,
// que só valida e PROCESSA EM MEMÓRIA (detectar tipo, sharp) e não grava nada. Mesma ordem do serviço real.

export const NOME_DEMONSTRACAO = 'Salão de demonstração';
export const URL_FOTO_EXEMPLO = '/dev-fotos/exemplo.svg';

export function fotosDeExemplo(n: number): FotoDoPainel[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `exemplo-${i + 1}`,
    posicao: i + 1,
    alt: `Foto de exemplo ${i + 1}`,
    largura: 640,
    altura: 480,
  }));
}

/** Valida e processa o envio sem gravar (mesma ordem de servico.enviar até o processamento). */
export async function demonstrarEnvio(entrada: EntradaEnvio): Promise<ResultadoAcao<ResultadoEnvio>> {
  const recusa = (codigo: Extract<ResultadoEnvio, { resultado: 'recusado' }>['codigo']): ResultadoAcao<ResultadoEnvio> => ({
    ok: true,
    dados: { resultado: 'recusado', codigo },
  });
  const corpo = await entrada.obterCorpo();
  if (!corpo.ok) return recusa(corpo.codigo);
  const alt = validarAlt(corpo.alt);
  if (!alt.ok) return recusa(alt.codigo);
  if (validarEnvioToken(corpo.envio) === null) return recusa('falha');
  const tipo = detectarTipo(corpo.arquivo);
  if (tipo === null) return recusa('tipo');
  const r = await processarImagem(corpo.arquivo, tipo);
  if (!r.ok) return recusa(r.erro);
  return { ok: true, dados: { resultado: 'ok', fotoId: null, duplicado: false } };
}
