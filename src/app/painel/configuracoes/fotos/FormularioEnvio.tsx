import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ErroDoCampo, Field } from '@/components/ui/Field';
import { LIMITES_FOTO, MENSAGENS_FOTO } from '@/server/fotos/tipos';
import type { CodigoEnvio } from '@/server/fotos/tipos';

import { campoDoErro, ID_CAMPO_ALT, ID_CAMPO_FOTO, ID_FORM_ENVIO, TEXTOS_FOTOS } from './estado';
import estilos from './Fotos.module.css';

export type FormularioEnvioProps = {
  /** Rota do envio multipart (ROTAS.envioFotos; a vitrine usa a própria). */
  action: string;
  /** Token de envio (UUID) gerado a cada renderização (RN-18). */
  token: string;
  /** Quantas fotos o salão já tem; com 12, o formulário é substituído pelo aviso do limite. */
  total: number;
  /** Código do `?envio=` já validado pela página (os erros de campo ficam ligados ao campo). */
  codigo?: CodigoEnvio | null;
};

/**
 * Envio de foto (D-021 RN-21): formulário HTML nativo `multipart/form-data`, que funciona sem
 * JavaScript. O erro do arquivo e o do texto ficam associados aos campos por `aria-describedby`.
 */
export function FormularioEnvio({ action, token, total, codigo = null }: FormularioEnvioProps) {
  if (total >= LIMITES_FOTO.maxFotos) {
    return <Alert variante="aviso">{TEXTOS_FOTOS.limiteAtingido}</Alert>;
  }
  const campo = campoDoErro(codigo);
  const idAjudaFoto = `${ID_CAMPO_FOTO}-ajuda`;
  const idErroFoto = `${ID_CAMPO_FOTO}-erro`;
  const descricaoFoto = [idAjudaFoto, campo === 'foto' ? idErroFoto : ''].filter(Boolean).join(' ');
  return (
    <form id={ID_FORM_ENVIO} method="post" action={action} encType="multipart/form-data" className={estilos.formulario}>
      <input type="hidden" name="envio" value={token} />
      <div className={estilos.campoArquivo}>
        <label htmlFor={ID_CAMPO_FOTO} className={estilos.rotulo}>
          Foto <span className={estilos.obrigatorio}>(obrigatório)</span>
        </label>
        <p id={idAjudaFoto} className={estilos.ajuda}>
          {TEXTOS_FOTOS.ajudaArquivo}
        </p>
        <input
          id={ID_CAMPO_FOTO}
          name="foto"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          className={estilos.arquivo}
          aria-describedby={descricaoFoto}
          aria-invalid={campo === 'foto' ? true : undefined}
        />
        {campo === 'foto' && codigo ? <ErroDoCampo id={idErroFoto} texto={MENSAGENS_FOTO[codigo]} /> : null}
      </div>
      <Field
        id={ID_CAMPO_ALT}
        name="alt"
        rotulo="Descrição da foto"
        ajuda={TEXTOS_FOTOS.ajudaAlt}
        obrigatorio
        maxLength={LIMITES_FOTO.maxAlt}
        autoComplete="off"
        erro={campo === 'alt' && codigo ? MENSAGENS_FOTO[codigo] : undefined}
      />
      <p className={estilos.ajuda}>{TEXTOS_FOTOS.privacidade}</p>
      <div className={estilos.acoes}>
        <Button type="submit">Enviar foto</Button>
      </div>
    </form>
  );
}
