'use client';

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ResumoDeErros } from '@/app/painel/_componentes/semana/ResumoDeErros';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { ErroDoCampo, Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { formatarInteiro } from '@/lib/format';
import { CAMPOS_PERFIL, COMODIDADES, LIMITES_PERFIL, MEIOS_PAGAMENTO, MENSAGENS_PERFIL as M, UFS } from '@/server/salao/perfil-tipos';
import type { CampoPerfil, ErrosPerfil, ValoresPerfil } from '@/server/salao/perfil-tipos';

import { estadoPerfilInicial, idDoCampo } from './estado';
import type { EstadoPerfil } from './estado';
import estilos from './Perfil.module.css';

export type FormularioPerfilProps = {
  /** Ação de servidor (real ou de demonstração) ou, nos testes, uma função equivalente. */
  acao: (anterior: EstadoPerfil, formData: FormData) => Promise<EstadoPerfil>;
  valoresIniciais: ValoresPerfil;
};

export const ROTULOS_PERFIL: Record<CampoPerfil, string> = {
  descricao: 'Descrição',
  logradouro: 'Logradouro (rua, avenida)',
  numero: 'Número',
  complemento: 'Complemento (opcional)',
  bairro: 'Bairro',
  cidade: 'Cidade',
  uf: 'UF',
  cep: 'CEP',
  telefone: 'Telefone',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  meiosPagamento: 'Meios de pagamento',
  comodidades: 'Comodidades',
};

const ID_RESUMO = 'perfil-resumo-erros';
const ID_SUCESSO = 'perfil-sucesso';
const ID_AJUDA = 'perfil-ajuda';
const ID_DESCRICAO = idDoCampo('descricao');
const ID_INSTAGRAM = idDoCampo('instagram');
const OPCOES_UF = UFS.map((uf) => ({ valor: uf, rotulo: uf }));

const semAssinatura = () => () => {};
/** true só no cliente hidratado (o contador é só com JavaScript). */
const useComJavaScript = () =>
  useSyncExternalStore(
    semAssinatura,
    () => true,
    () => false,
  );

/** Itens do resumo de erros, na ordem dos campos. */
function itensDoResumo(erros: ErrosPerfil) {
  return CAMPOS_PERFIL.filter((campo) => erros[campo]).map((campo) => ({
    href: `#${idDoCampo(campo)}`,
    texto: `${ROTULOS_PERFIL[campo]}: ${erros[campo]}`,
  }));
}

function Descricao({ valor, erro }: { valor: string; erro?: string }) {
  const comJs = useComJavaScript();
  const [tamanho, setTamanho] = useState(valor.length);
  const descricao = [`${ID_DESCRICAO}-ajuda`, comJs ? `${ID_DESCRICAO}-contador` : '', erro ? `${ID_DESCRICAO}-erro` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={estilos.campo}>
      <label htmlFor={ID_DESCRICAO} className={estilos.rotulo}>
        {ROTULOS_PERFIL.descricao}
      </label>
      <p id={`${ID_DESCRICAO}-ajuda`} className={estilos.ajuda}>
        {M.ajudaDescricao}
      </p>
      <textarea
        id={ID_DESCRICAO}
        name="descricao"
        className={estilos.texto}
        rows={6}
        maxLength={LIMITES_PERFIL.descricao}
        defaultValue={valor}
        onChange={(e) => setTamanho(e.currentTarget.value.length)}
        aria-describedby={descricao}
        aria-invalid={erro ? true : undefined}
      />
      {comJs ? (
        <p id={`${ID_DESCRICAO}-contador`} className={estilos.ajuda} aria-live="polite">
          {formatarInteiro(tamanho)} de {formatarInteiro(LIMITES_PERFIL.descricao)} caracteres
        </p>
      ) : null}
      {erro ? <ErroDoCampo id={`${ID_DESCRICAO}-erro`} texto={erro} /> : null}
    </div>
  );
}

type ListaProps = {
  campo: 'meiosPagamento' | 'comodidades';
  opcoes: readonly { chave: string; rotulo: string }[];
  marcadas: readonly string[];
  erro?: string;
};

function Lista({ campo, opcoes, marcadas, erro }: ListaProps) {
  const idErro = `${idDoCampo(campo)}-erro`;
  return (
    <fieldset className={estilos.grupo}>
      <legend>{ROTULOS_PERFIL[campo]}</legend>
      {erro ? <ErroDoCampo id={idErro} texto={erro} /> : null}
      <div className={estilos.caixas}>
        {opcoes.map((o, i) => (
          <Checkbox
            key={o.chave}
            id={i === 0 ? idDoCampo(campo) : `${idDoCampo(campo)}-${o.chave}`}
            name={campo}
            value={o.chave}
            rotulo={o.rotulo}
            defaultChecked={marcadas.includes(o.chave)}
            aria-describedby={erro ? idErro : undefined}
            aria-invalid={erro ? true : undefined}
          />
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Perfil público do salão (D-020 §3.8; RN-4..RN-10, RN-19). Funciona sem JavaScript (useActionState;
 * estado na resposta, sem PRG). Com erros, resumo no topo com links para os campos, focado ao chegar;
 * com sucesso, a mensagem é focada e os campos renascem com os valores normalizados do servidor
 * (`key` do formulário derivada dos valores, A-9).
 */
export function FormularioPerfil({ acao, valoresIniciais }: FormularioPerfilProps) {
  const [estado, enviar, pendente] = useActionState(acao, estadoPerfilInicial(valoresIniciais));
  const resumo = useRef<HTMLDivElement>(null);
  const sucesso = useRef<HTMLDivElement>(null);
  const { erros, valores } = estado;
  const itens = itensDoResumo(erros);
  const temErros = itens.length > 0;

  useEffect(() => {
    if (temErros) resumo.current?.focus();
    else if (estado.sucesso) sucesso.current?.focus();
  }, [estado, temErros]);

  const texto = (campo: Exclude<CampoPerfil, 'descricao' | 'uf' | 'instagram' | 'meiosPagamento' | 'comodidades'>) => ({
    id: idDoCampo(campo),
    name: campo,
    rotulo: ROTULOS_PERFIL[campo],
    defaultValue: valores[campo],
    erro: erros[campo],
  });
  const descricaoInstagram = [`${ID_INSTAGRAM}-ajuda`, erros.instagram ? `${ID_INSTAGRAM}-erro` : ''].filter(Boolean).join(' ');

  return (
    <form action={enviar} className={estilos.formulario} noValidate key={JSON.stringify(valores)}>
      {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
      {erros.formulario ? <Alert variante="erro">{erros.formulario}</Alert> : null}
      {temErros ? <ResumoDeErros ref={resumo} id={ID_RESUMO} titulo={M.resumoErros} itens={itens} /> : null}
      {estado.sucesso && !temErros ? (
        <div ref={sucesso} id={ID_SUCESSO} tabIndex={-1} className={estilos.sucesso}>
          <Alert variante="sucesso">{estado.sucesso}</Alert>
        </div>
      ) : null}
      <p id={ID_AJUDA} className={estilos.ajuda}>
        {M.ajudaPublico}
      </p>

      <Descricao valor={valores.descricao} erro={erros.descricao} />

      <fieldset className={estilos.grupo}>
        <legend>Endereço</legend>
        <Field {...texto('logradouro')} maxLength={LIMITES_PERFIL.logradouro} autoComplete="address-line1" />
        <div className={estilos.par}>
          <Field {...texto('numero')} maxLength={LIMITES_PERFIL.numero} autoComplete="off" />
          <Field {...texto('complemento')} maxLength={LIMITES_PERFIL.complemento} autoComplete="address-line2" />
        </div>
        <Field {...texto('bairro')} maxLength={LIMITES_PERFIL.bairro} autoComplete="address-level3" />
        <div className={estilos.trio}>
          <Field {...texto('cidade')} maxLength={LIMITES_PERFIL.cidade} autoComplete="address-level2" />
          <Select
            id={idDoCampo('uf')}
            name="uf"
            rotulo={ROTULOS_PERFIL.uf}
            opcoes={OPCOES_UF}
            textoVazio="—"
            defaultValue={valores.uf}
            erro={erros.uf}
            autoComplete="address-level1"
          />
          <Field {...texto('cep')} maxLength={9} inputMode="numeric" autoComplete="postal-code" />
        </div>
      </fieldset>

      <fieldset className={estilos.grupo}>
        <legend>Contato</legend>
        <Field {...texto('telefone')} tipo="tel" maxLength={30} autoComplete="tel" />
        <Field {...texto('whatsapp')} tipo="tel" maxLength={30} autoComplete="tel" />
        <div className={estilos.campo}>
          <label htmlFor={ID_INSTAGRAM} className={estilos.rotulo}>
            {ROTULOS_PERFIL.instagram}
          </label>
          <p id={`${ID_INSTAGRAM}-ajuda`} className={estilos.ajuda}>
            Perfil ou endereço do Instagram (ex.: @meusalao).
          </p>
          <div className={estilos.prefixado}>
            <span className={estilos.prefixo} aria-hidden="true">
              @
            </span>
            <input
              id={ID_INSTAGRAM}
              name="instagram"
              type="text"
              className={estilos.controle}
              maxLength={LIMITES_PERFIL.instagramMaxBruto}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              defaultValue={valores.instagram}
              aria-describedby={descricaoInstagram}
              aria-invalid={erros.instagram ? true : undefined}
            />
          </div>
          {erros.instagram ? <ErroDoCampo id={`${ID_INSTAGRAM}-erro`} texto={erros.instagram} /> : null}
        </div>
      </fieldset>

      <Lista campo="meiosPagamento" opcoes={MEIOS_PAGAMENTO} marcadas={valores.meiosPagamento} erro={erros.meiosPagamento} />
      <Lista campo="comodidades" opcoes={COMODIDADES} marcadas={valores.comodidades} erro={erros.comodidades} />

      <div className={estilos.acoes}>
        <Button type="submit" ocupado={pendente} rotuloOcupado="Salvando…">
          Salvar perfil
        </Button>
      </div>
    </form>
  );
}
