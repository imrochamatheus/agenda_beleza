import { Button } from '@/components/ui/Button';
import { ROTAS } from '@/config/navegacao';
import { LIMITES_FOTO } from '@/server/fotos/tipos';
import type { FotoDoPainel } from '@/server/fotos/tipos';

import { nomeDoBotao, TEXTOS_FOTOS } from './estado';
import estilos from './Fotos.module.css';

export type AcoesDaLista = {
  /** Recebem o FormData do formulário de cada foto (ações de servidor reais ou de demonstração). */
  alt: (formData: FormData) => Promise<void>;
  mover: (formData: FormData) => Promise<void>;
  remover: (formData: FormData) => Promise<void>;
};

export type ListaFotosProps = {
  fotos: readonly FotoDoPainel[];
  acoes: AcoesDaLista;
  /** URL da miniatura (padrão: a rota pública da app; a vitrine usa data:). */
  urlDe?: (foto: FotoDoPainel) => string;
};

/**
 * Lista das fotos na ordem (D-021 RN-21). Componente de servidor (também usado na vitrine). Cada foto:
 * miniatura com o próprio `alt` e `width`/`height` gravados, posição, edição do texto alternativo,
 * "Mover para cima/baixo" (desabilitados com aria-disabled nas pontas, sem escrita) e "Remover". Todos
 * são formulários que funcionam sem JavaScript; os nomes acessíveis identificam a foto.
 */
export function ListaFotos({ fotos, acoes, urlDe = (f) => ROTAS.fotoPublica(f.id) }: ListaFotosProps) {
  if (fotos.length === 0) {
    return <p className={estilos.vazio}>{TEXTOS_FOTOS.vazio}</p>;
  }
  return (
    <ol className={estilos.lista} aria-label="Fotos do salão">
      {fotos.map((foto, indice) => {
        const n = foto.posicao;
        const idAlt = `foto-alt-${foto.id}`;
        return (
          <li key={foto.id} className={estilos.item}>
            <div className={estilos.miniatura}>
              {/* eslint-disable-next-line @next/next/no-img-element -- imagem já reduzida (≤ 1600 px, WebP) e entregue pela rota da app ou pela CDN; next/image exigiria remotePatterns e otimização (design A-1, §1.1) */}
              <img src={urlDe(foto)} alt={foto.alt} width={foto.largura} height={foto.altura} loading="lazy" className={estilos.imagem} />
            </div>
            <div className={estilos.detalhes}>
              <p className={estilos.posicao}>
                Foto {n} de {fotos.length}
              </p>
              <form action={acoes.alt} className={estilos.formAlt}>
                <input type="hidden" name="fotoId" value={foto.id} />
                <div className={estilos.campoAlt}>
                  <label htmlFor={idAlt} className={estilos.rotulo}>
                    Descrição da foto {n}
                  </label>
                  <input
                    id={idAlt}
                    name="alt"
                    type="text"
                    defaultValue={foto.alt}
                    maxLength={LIMITES_FOTO.maxAlt}
                    required
                    autoComplete="off"
                    className={estilos.controle}
                  />
                </div>
                <Button type="submit" variante="secundaria" aria-label={nomeDoBotao.salvarAlt(n)}>
                  Salvar descrição
                </Button>
              </form>
              <div className={estilos.acoesFoto}>
                <form action={acoes.mover}>
                  <input type="hidden" name="fotoId" value={foto.id} />
                  <input type="hidden" name="posicaoEsperada" value={n} />
                  <input type="hidden" name="direcao" value="cima" />
                  <Button type="submit" variante="secundaria" aria-label={nomeDoBotao.cima(n)} desabilitadoFocavel={indice === 0}>
                    Mover para cima
                  </Button>
                </form>
                <form action={acoes.mover}>
                  <input type="hidden" name="fotoId" value={foto.id} />
                  <input type="hidden" name="posicaoEsperada" value={n} />
                  <input type="hidden" name="direcao" value="baixo" />
                  <Button type="submit" variante="secundaria" aria-label={nomeDoBotao.baixo(n)} desabilitadoFocavel={indice === fotos.length - 1}>
                    Mover para baixo
                  </Button>
                </form>
                <form action={acoes.remover}>
                  <input type="hidden" name="fotoId" value={foto.id} />
                  <Button type="submit" variante="perigo" aria-label={nomeDoBotao.remover(n)}>
                    Remover
                  </Button>
                </form>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
