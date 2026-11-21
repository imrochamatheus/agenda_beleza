import estilos from './FormularioAdmin.module.css';

export type PassoCadastroProps = {
  /** SVG gerado no servidor (qr.ts): conteúdo confiável, sem URL nem script. */
  svg: string;
  /** Chave em grupos de 4, alternativa ao QR. */
  chaveAgrupada: string;
  email: string;
};

/** Instruções, QR e chave em texto do cadastro do TOTP (D-034 RN-6). Funciona sem JavaScript. */
export function PassoCadastro({ svg, chaveAgrupada, email }: PassoCadastroProps) {
  return (
    <div className={estilos.passos}>
      <p>
        Primeiro acesso de <strong>{email}</strong>: configure o segundo fator. Leia o QR code no aplicativo
        autenticador e digite o código de 6 dígitos que ele mostrar.
      </p>
      <div className={estilos.qr} dangerouslySetInnerHTML={{ __html: svg }} />
      <p>
        Sem câmera? Digite esta chave no aplicativo (tipo: baseado em tempo):
      </p>
      <p>
        <code className={estilos.chave}>{chaveAgrupada}</code>
      </p>
    </div>
  );
}
