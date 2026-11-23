'use client';

import { Fragment, useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Field } from '@/components/ui/Field';
import { RoteiroDoDia } from '@/components/ui/RoteiroDoDia';
import { ROTAS } from '@/config/navegacao';
import { CAMPOS_CONSENTIMENTO, TEXTOS_CONSENTIMENTO } from '@/config/termos';
import { formatarDuracao, formatarHora } from '@/lib/format';

import { idDaLinha, idDoCampo, MAXIMO_LINHAS, MENSAGENS_FORMULARIO_RESERVA, textoDosMotivos } from './estado';
import type { CampoDaLinha, CampoGeral, EstadoReservaManual } from './estado';
import { LinhaDeItem } from './LinhaDeItem';
import type { OpcaoDeServico } from './LinhaDeItem';
import estilos from './NovaReserva.module.css';

export type { OpcaoDeServico };

export type FormularioReservaManualProps = {
  /** Ação de servidor (a real ou a de demonstração) ou, nos testes, uma função equivalente. */
  acao: (anterior: EstadoReservaManual, formData: FormData) => Promise<EstadoReservaManual>;
  estadoInicial: EstadoReservaManual;
  servicos: OpcaoDeServico[];
  /** Gestor: opções do profissional; null = profissional (agenda própria, fixa). */
  profissionais: { valor: string; rotulo: string }[] | null;
  /** Profissional logado: id e nome mostrados no lugar do seletor de cada linha. */
  profissionalFixo?: { id: string; nome: string };
  /** Fuso do salão (IANA), para as horas do roteiro da reserva registrada. */
  fuso: string;
};

const ROTULOS_GERAIS: Record<CampoGeral, string> = {
  data: 'Data',
  itens: 'Serviços',
  nome: 'Nome da cliente',
  telefone: 'Telefone (WhatsApp)',
};
const ROTULOS_DA_LINHA: Record<CampoDaLinha, string> = { servico: 'Serviço', profissional: 'Profissional', hora: 'Hora' };
const CAMPOS_DA_LINHA: readonly CampoDaLinha[] = ['servico', 'profissional', 'hora'];
const ID_RESUMO = 'reserva-resumo-erros';
const ID_AVISO = 'reserva-aviso-encaixe';
const ID_CRIADA = 'reserva-criada';

type ItemDoResumo = { href: string; texto: string };

/** Ordem da tela: Data, cada linha (Serviço, Profissional, Hora), Nome, Telefone. */
function itensDoResumo(estado: EstadoReservaManual): ItemDoResumo[] {
  const { erros, errosPorLinha, valores } = estado;
  const gerais = (campos: readonly CampoGeral[]) =>
    campos.filter((c) => erros[c]).map((c) => ({
      href: c === 'itens' ? `#${idDaLinha(0, 'servico')}` : `#${idDoCampo(c)}`,
      texto: `${ROTULOS_GERAIS[c]}: ${erros[c]}`,
    }));
  const linhas = valores.itens.flatMap((_, k) =>
    CAMPOS_DA_LINHA.filter((c) => errosPorLinha[k]?.[c]).map((c) => ({
      href: `#${idDaLinha(k, c)}`,
      texto: `Serviço ${k + 1} — ${ROTULOS_DA_LINHA[c]}: ${errosPorLinha[k][c]}`,
    })),
  );
  return [...gerais(['data', 'itens']), ...linhas, ...gerais(['nome', 'telefone'])];
}

/**
 * Nova reserva da equipe (D-029; D-050 web-design §5.8): uma data para todos os serviços e N linhas
 * "Serviço n" (serviço, profissional, hora). Funciona sem JavaScript (useActionState): "Adicionar outro
 * serviço" e "Remover" são botões de envio que devolvem o formulário com uma linha a mais/a menos e tudo o
 * que foi digitado; o aviso de encaixe lista os itens com motivo e UMA caixa confirma todos. O primeiro filho
 * do formulário é um botão de envio oculto (C5): o Enter implícito num campo registra a reserva, nunca
 * adiciona nem remove linha. Com JS, o foco vai ao resumo de erros, ao aviso, ao resultado ou à legenda da
 * linha depois de adicionar/remover.
 */
export function FormularioReservaManual({ acao, estadoInicial, servicos, profissionais, profissionalFixo, fuso }: FormularioReservaManualProps) {
  const [estado, enviar, pendente] = useActionState(acao, estadoInicial);
  const resumo = useRef<HTMLDivElement>(null);
  const aviso = useRef<HTMLDivElement>(null);
  const criada = useRef<HTMLDivElement>(null);
  const { erros, errosPorLinha, valores, encaixe } = estado;
  const itensResumo = itensDoResumo(estado);
  const temErros = itensResumo.length > 0;
  const pedeConfirmacao = encaixe !== null && encaixe.length > 0;
  const total = valores.itens.length;

  const nomeDoServico = (id: string) => servicos.find((s) => s.id === id)?.nome ?? 'Serviço';
  const nomeDoProfissional = (id: string) =>
    profissionais === null ? (profissionalFixo?.nome ?? '') : (profissionais.find((p) => p.valor === id)?.rotulo ?? '');
  const encaixePorLinha = new Map((encaixe ?? []).map((m) => [m.indice, textoDosMotivos(m.motivos)]));

  useEffect(() => {
    if (temErros) resumo.current?.focus();
    else if (pedeConfirmacao) aviso.current?.focus();
    else if (estado.criada) criada.current?.focus();
    else if (estado.foco !== null) document.getElementById(idDaLinha(estado.foco, 'legenda'))?.focus();
  }, [estado, temErros, pedeConfirmacao]);

  return (
    <form action={enviar} className={estilos.formulario} noValidate>
      {/* C5: botão padrão do formulário (Enter implícito registra). `hidden` o tira da tabulação e da árvore de acessibilidade. */}
      <button type="submit" hidden tabIndex={-1} />
      <input type="hidden" name="chave" value={estado.chave} />
      <input type="hidden" name="itens" value={total} />

      {estado.mensagem ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
      {temErros ? (
        <div ref={resumo} id={ID_RESUMO} tabIndex={-1} className={estilos.resumoErros} role="alert" aria-labelledby={`${ID_RESUMO}-titulo`}>
          <p id={`${ID_RESUMO}-titulo`} className={estilos.titulo}>
            {MENSAGENS_FORMULARIO_RESERVA.resumoErros}
          </p>
          <ul>
            {itensResumo.map((item) => (
              <li key={item.texto}>
                <a href={item.href}>{item.texto}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {pedeConfirmacao ? (
        <div ref={aviso} id={ID_AVISO} tabIndex={-1} className={estilos.aviso} role="alert" aria-labelledby={`${ID_AVISO}-titulo`}>
          <p id={`${ID_AVISO}-titulo`} className={estilos.titulo}>
            {MENSAGENS_FORMULARIO_RESERVA.encaixeTitulo}
          </p>
          <p>{MENSAGENS_FORMULARIO_RESERVA.encaixeTexto}</p>
          <ul>
            {encaixe.map((m) => {
              const linha = valores.itens[m.indice];
              return (
                <li key={m.indice}>
                  Serviço {m.indice + 1} — {nomeDoServico(linha?.servicoId ?? '')} com {nomeDoProfissional(linha?.profissionalId ?? '')} às{' '}
                  {linha?.hora.trim() ?? ''}: {textoDosMotivos(m.motivos)}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {estado.criada && !temErros ? (
        <div ref={criada} id={ID_CRIADA} tabIndex={-1} className={estilos.criada} role="status" aria-labelledby={`${ID_CRIADA}-titulo`}>
          <p id={`${ID_CRIADA}-titulo`} className={estilos.titulo}>
            {estado.criada.repetida
              ? MENSAGENS_FORMULARIO_RESERVA.repetida
              : estado.criada.encaixes > 0
                ? MENSAGENS_FORMULARIO_RESERVA.criadaEncaixe(estado.criada.encaixes)
                : MENSAGENS_FORMULARIO_RESERVA.criada}
          </p>
          {estado.criada.itens.length > 0 ? (
            <RoteiroDoDia
              rotulo="Serviços da reserva"
              paradas={estado.criada.itens.map((i, k) => ({
                chave: `${k}-${i.servicoId}`,
                hora: formatarHora(new Date(i.inicioIso), fuso),
                fim: formatarHora(new Date(i.fimIso), fuso),
                servico: nomeDoServico(i.servicoId),
                profissional: nomeDoProfissional(i.profissionalId),
                detalhe: formatarDuracao(i.duracaoMin),
                estado: 'escolhida' as const,
                etiquetas: i.encaixe ? [{ texto: 'Encaixe', variante: 'encaixe' as const }] : undefined,
              }))}
            />
          ) : null}
          <a className={estilos.link} href={estado.criada.hrefAgenda}>
            Ver na agenda
          </a>
        </div>
      ) : null}

      {estado.statusLinha ? (
        <p role="status" className={estilos.statusLinha}>
          {estado.statusLinha}
        </p>
      ) : null}

      <Field
        id={idDoCampo('data')}
        name="data"
        tipo="date"
        rotulo={ROTULOS_GERAIS.data}
        ajuda={MENSAGENS_FORMULARIO_RESERVA.ajudaData}
        defaultValue={valores.data}
        erro={erros.data}
        className={estilos.data}
        key={`d-${valores.data}`}
      />

      <p className={estilos.ajuda}>{MENSAGENS_FORMULARIO_RESERVA.ajudaLinhas}</p>
      {valores.itens.map((linha, k) => (
        <LinhaDeItem
          key={`linha-${k}`}
          indice={k}
          total={total}
          valores={linha}
          erros={errosPorLinha[k] ?? {}}
          servicos={servicos}
          profissionais={profissionais}
          profissionalFixo={profissionalFixo}
          encaixe={encaixePorLinha.get(k) ?? null}
        />
      ))}
      {total < MAXIMO_LINHAS ? (
        <div className={estilos.adicionar}>
          <Button type="submit" variante="secundaria" name="linha" value="adicionar" aria-describedby="reserva-ajuda-adicionar">
            Adicionar outro serviço
          </Button>
          <p id="reserva-ajuda-adicionar" className={estilos.ajuda}>
            {MENSAGENS_FORMULARIO_RESERVA.ajudaAdicionar}
          </p>
        </div>
      ) : null}

      <Field
        id={idDoCampo('nome')}
        name="nome"
        rotulo={ROTULOS_GERAIS.nome}
        autoComplete="off"
        maxLength={100}
        defaultValue={valores.nome}
        erro={erros.nome}
        key={`n-${valores.nome}`}
      />
      <Field
        id={idDoCampo('telefone')}
        name="telefone"
        tipo="tel"
        rotulo={ROTULOS_GERAIS.telefone}
        autoComplete="off"
        maxLength={30}
        defaultValue={valores.telefone}
        erro={erros.telefone}
        key={`t-${valores.telefone}`}
      />

      <fieldset className={estilos.grupo}>
        <legend>Mensagens da reserva</legend>
        <p className={estilos.ajuda}>
          Marque somente se a cliente concordou com o texto abaixo. Sem o aceite, a reserva é registrada e nenhuma mensagem é enviada.
        </p>
        <Checkbox
          id="reserva-consentimento-mensagens"
          name={CAMPOS_CONSENTIMENTO.mensagensReserva}
          defaultChecked={valores.mensagens}
          key={`m-${valores.mensagens}`}
          rotulo={TEXTOS_CONSENTIMENTO.mensagens_reserva.map((parte, i) =>
            typeof parte === 'string' ? (
              <Fragment key={i}>{parte}</Fragment>
            ) : (
              <a key={i} href={ROTAS[parte.link]} target="_blank" rel="noopener">
                {parte.texto}
                <span className="visualmente-oculto"> (abre em nova aba)</span>
              </a>
            ),
          )}
        />
      </fieldset>

      {pedeConfirmacao ? (
        <Checkbox
          id="reserva-confirmar-encaixe"
          name="confirmarEncaixe"
          rotulo={MENSAGENS_FORMULARIO_RESERVA.confirmarEncaixe}
          defaultChecked={valores.confirmarEncaixe}
          key={`c-${valores.confirmarEncaixe}`}
        />
      ) : null}

      <div className={estilos.acoes}>
        <Button type="submit" ocupado={pendente} rotuloOcupado="Registrando…">
          Registrar reserva
        </Button>
      </div>
    </form>
  );
}
