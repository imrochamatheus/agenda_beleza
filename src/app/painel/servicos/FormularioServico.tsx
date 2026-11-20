'use client';

import { useActionState, useId } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { ErroDoCampo, Field } from '@/components/ui/Field';
import { ROTAS } from '@/config/navegacao';
import { formatarMoedaSemSimbolo } from '@/lib/format';
import { LIMITES_SERVICO, MENSAGENS_SERVICO } from '@/server/servicos/tipos';
import type { ProfissionalOpcao } from '@/server/servicos/tipos';

import { ESTADO_INICIAL_FORMULARIO_SERVICO } from './estado';
import type { EstadoFormularioServico } from './estado';
import estilos from './FormularioServico.module.css';

export type FormularioServicoProps = {
  modo: 'criar' | 'editar';
  /** Ação de servidor (criarServicoAcao/editarServicoAcao) ou, nos testes, uma função equivalente. */
  acao: (anterior: EstadoFormularioServico, formData: FormData) => Promise<EstadoFormularioServico>;
  /** Ativos (caixas, marcadas se vinculados) e inativos vinculados (só texto, D-5). */
  profissionais: readonly ProfissionalOpcao[];
  /** Obrigatório no modo editar: valores iniciais e id oculto. */
  servico?: { id: string; nome: string; precoCentavos: number; duracaoMin: number };
};

function estadoInicial(p: FormularioServicoProps): EstadoFormularioServico {
  if (!p.servico) return ESTADO_INICIAL_FORMULARIO_SERVICO;
  return {
    ...ESTADO_INICIAL_FORMULARIO_SERVICO,
    valores: {
      nome: p.servico.nome,
      preco: formatarMoedaSemSimbolo(p.servico.precoCentavos),
      duracao: String(p.servico.duracaoMin),
      profissionais: p.profissionais.filter((x) => x.ativo && x.vinculado).map((x) => x.id),
    },
  };
}

/**
 * Cadastro e edição de serviço com os profissionais que o executam (D-014 RN-1, RN-10, RN-11). Envia
 * por POST como formulário HTML mesmo antes da hidratação. Rótulos associados, erros ligados por
 * aria-describedby (Field e o fieldset dos profissionais) e erro geral em Alert (role="alert"). Os
 * valores e as caixas vêm de `estado.valores`: preservados depois de um erro, com ou sem JavaScript.
 */
export function FormularioServico(props: FormularioServicoProps) {
  const { modo, acao, profissionais, servico } = props;
  const [estado, enviar, pendente] = useActionState(acao, estadoInicial(props));
  const idErroProfissionais = useId();
  const ativos = profissionais.filter((p) => p.ativo);
  const inativosVinculados = profissionais.filter((p) => !p.ativo && p.vinculado);
  const marcados = new Set(estado.valores.profissionais);

  return (
    <form action={enviar} className={estilos.formulario} noValidate>
      {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
      {estado.erros.formulario ? <Alert variante="erro">{estado.erros.formulario}</Alert> : null}
      {servico ? <input type="hidden" name="id" value={servico.id} /> : null}
      <Field
        rotulo="Nome"
        name="nome"
        autoComplete="off"
        defaultValue={estado.valores.nome}
        erro={estado.erros.nome}
        maxLength={LIMITES_SERVICO.nome.max}
        obrigatorio
      />
      <Field
        rotulo="Preço (R$)"
        name="preco"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={estado.valores.preco}
        erro={estado.erros.preco}
        ajuda={MENSAGENS_SERVICO.ajudaPreco}
        maxLength={LIMITES_SERVICO.precoMaxCaracteres}
        obrigatorio
      />
      <Field
        rotulo="Duração (minutos)"
        tipo="number"
        name="duracao"
        inputMode="numeric"
        min={LIMITES_SERVICO.duracao.min}
        max={LIMITES_SERVICO.duracao.max}
        step={LIMITES_SERVICO.duracao.passo}
        defaultValue={estado.valores.duracao}
        erro={estado.erros.duracao}
        ajuda="Múltiplo de 5, de 5 a 720."
        obrigatorio
      />
      <fieldset
        className={estilos.profissionais}
        aria-describedby={estado.erros.profissionais ? idErroProfissionais : undefined}
      >
        <legend>Profissionais que executam</legend>
        {ativos.length === 0 ? (
          <p>
            Nenhum profissional ativo. <a href={ROTAS.novoProfissional}>Cadastrar profissional</a>
          </p>
        ) : (
          ativos.map((p) => (
            <Checkbox
              key={p.id}
              name="profissionais"
              value={p.id}
              rotulo={p.nome}
              defaultChecked={marcados.has(p.id)}
            />
          ))
        )}
        {inativosVinculados.length > 0 ? (
          <div className={estilos.inativos}>
            <p>Profissionais inativos com vínculo:</p>
            <ul>
              {inativosVinculados.map((p) => (
                <li key={p.id}>
                  {p.nome}: Inativo, vínculo mantido
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {estado.erros.profissionais ? <ErroDoCampo id={idErroProfissionais} texto={estado.erros.profissionais} /> : null}
      </fieldset>
      <div className={estilos.acoes}>
        <Button type="submit" ocupado={pendente} rotuloOcupado="Salvando…">
          {modo === 'criar' ? 'Cadastrar serviço' : 'Salvar alterações'}
        </Button>
        <a href={ROTAS.servicos}>Voltar para a lista</a>
      </div>
    </form>
  );
}
