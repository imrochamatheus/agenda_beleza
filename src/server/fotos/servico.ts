import { exigirPermissao } from '@/server/auth/permissoes';
import { processarImagem } from '@/server/imagem/processar';
import { detectarTipo } from '@/server/imagem/detectar';
import { gerarChave } from '@/server/integrations/armazenamento/chave';
import type { PortaArmazenamento } from '@/server/integrations/armazenamento/port';
import { integracoes } from '@/server/integrations/registry';
import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';

import type {
  EntradaAlt,
  EntradaEnvio,
  EntradaMover,
  EntradaRemover,
  ResultadoAlt,
  ResultadoEnvio,
  ResultadoMover,
  ResultadoRemover,
} from './tipos';
import { validarAlt, validarEnvioToken, validarPosicaoEsperada } from './validacao';

// Serviço das fotos do salão (D-021 §3.4; RN-1..RN-18). Sem next/*: as ações (fotos.acao.ts) o chamam.
// Só o salão do contexto. Cada função começa por exigirPermissao (segunda barreira, depois de
// defineAcao). A trava do salão (`saloes.travar`) nunca é mantida durante a E/S do armazenamento
// (A-2). Logs só com ids, códigos e tamanhos: nunca o texto alternativo, o nome do arquivo ou bytes.

export type DepsFotos = {
  armazenamento?: PortaArmazenamento;
  processar?: typeof processarImagem;
};

function registrar(evento: string, dados: Record<string, unknown>, nivel: 'info' | 'warn' = 'info'): void {
  console[nivel](JSON.stringify({ evento, ...dados }));
}

const recusado = (codigo: Extract<ResultadoEnvio, { resultado: 'recusado' }>['codigo']): ResultadoEnvio => ({ resultado: 'recusado', codigo });

/** Remove um objeto de melhor esforço: falha → log `armazenamento.orfao` (chave aleatória, sem dado pessoal). */
async function removerObjeto(porta: PortaArmazenamento, chave: string, motivo: string): Promise<void> {
  try {
    await porta.remover(chave);
  } catch (e) {
    registrar('armazenamento.orfao', { chave, motivo, erro: e instanceof Error ? e.name : 'erro' }, 'warn');
  }
}

/** Envio (RN-16/RN-18, A-14). Ordem exata do design §3.4. */
export async function enviar(ctx: TenantContext, entrada: EntradaEnvio, deps: DepsFotos = {}): Promise<ResultadoEnvio> {
  exigirPermissao(ctx, 'salao.configurar');
  const corpo = await entrada.obterCorpo();
  if (!corpo.ok) {
    return recusado(corpo.codigo);
  }
  const alt = validarAlt(corpo.alt);
  if (!alt.ok) {
    return recusado(alt.codigo);
  }
  const envio = validarEnvioToken(corpo.envio);
  if (envio === null) {
    return recusado('falha');
  }
  const tipo = detectarTipo(corpo.arquivo);
  if (tipo === null) {
    return recusado('tipo');
  }
  const processada = await (deps.processar ?? processarImagem)(corpo.arquivo, tipo);
  if (!processada.ok) {
    return recusado(processada.erro);
  }
  const { imagem } = processada;

  const pre = await repos().fotos.prechecar(ctx, envio);
  if (pre.tokenExiste) {
    return { resultado: 'ok', fotoId: null, duplicado: true };
  }
  if (pre.contagem >= 12) {
    return recusado('limite');
  }

  const armazenamento = deps.armazenamento ?? integracoes().armazenamento;
  const chave = gerarChave();
  try {
    await armazenamento.gravar(chave, imagem.bytes, 'image/webp');
  } catch (e) {
    registrar('foto.falha_ao_gravar', { salaoId: ctx.salaoId, erro: e instanceof Error ? e.name : 'erro' }, 'warn');
    return recusado('falha');
  }

  let r;
  try {
    r = await emTransacao(async (rs) => {
      await rs.saloes.travar(ctx);
      return rs.fotos.inserirNoFim(ctx, {
        chave,
        alt: alt.alt,
        largura: imagem.largura,
        altura: imagem.altura,
        bytes: imagem.bytes.byteLength,
        envio,
      });
    });
  } catch (e) {
    await removerObjeto(armazenamento, chave, 'transacao_falhou');
    throw e;
  }
  if (r.resultado !== 'criada') {
    await removerObjeto(armazenamento, chave, r.resultado);
    return r.resultado === 'limite' ? recusado('limite') : { resultado: 'ok', fotoId: null, duplicado: true };
  }
  registrar('foto.enviada', { salaoId: ctx.salaoId, fotoId: r.id, bytes: imagem.bytes.byteLength, largura: imagem.largura, altura: imagem.altura });
  return { resultado: 'ok', fotoId: r.id, duplicado: false };
}

/** Texto alternativo (RN-9, RN-12). Foto de outro salão ou inexistente → NaoEncontrado. */
export async function editarAlt(ctx: TenantContext, e: EntradaAlt): Promise<ResultadoAlt> {
  exigirPermissao(ctx, 'salao.configurar');
  const alt = validarAlt(e?.alt);
  if (!alt.ok) {
    return { resultado: 'invalido', erro: alt.erro };
  }
  await emTransacao(async (rs) => {
    await rs.saloes.travar(ctx);
    return rs.fotos.editarAlt(ctx, e.fotoId, alt.alt);
  });
  return { resultado: 'salvo' };
}

/** Reordenação (RN-11): posição esperada; entrada fora do contrato não escreve. */
export async function mover(ctx: TenantContext, e: EntradaMover): Promise<ResultadoMover> {
  exigirPermissao(ctx, 'salao.configurar');
  const esperada = validarPosicaoEsperada(e?.posicaoEsperada);
  if ((e?.direcao !== 'cima' && e?.direcao !== 'baixo') || esperada === null) {
    return { resultado: 'ordem_mudou' };
  }
  const direcao = e.direcao;
  const resultado = await emTransacao(async (rs) => {
    await rs.saloes.travar(ctx);
    return rs.fotos.trocarComVizinha(ctx, e.fotoId, direcao, esperada);
  });
  return { resultado };
}

/** Remoção (RN-16): a linha sai e as posições compactam no commit; o objeto, DEPOIS do commit, sem desfazer nada. */
export async function remover(ctx: TenantContext, e: EntradaRemover, deps: DepsFotos = {}): Promise<ResultadoRemover> {
  exigirPermissao(ctx, 'salao.configurar');
  const { chave } = await emTransacao(async (rs) => {
    await rs.saloes.travar(ctx);
    return rs.fotos.removerCompactando(ctx, e?.fotoId);
  });
  await removerObjeto(deps.armazenamento ?? integracoes().armazenamento, chave, 'remocao_pos_commit');
  registrar('foto.removida', { salaoId: ctx.salaoId, fotoId: e.fotoId });
  return { resultado: 'removida' };
}
