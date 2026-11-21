import { COMODIDADES, MEIOS_PAGAMENTO } from '@/server/salao/perfil-tipos';
import { ORDEM_EXIBICAO_DIAS } from '@/server/semana/tipos';
import type { FotoPublica } from '@/server/fotos/tipos';
import type { PerfilPublico, ProfissionalPublico, ServicoPublico } from '@/server/repos/publico';
import { formatarCep, formatarDiaDaSemana, formatarDuracao, formatarFaixaDeMinutos, formatarMoeda, formatarTelefone } from '@/lib/format';

import estilos from './Salao.module.css';

/** Foto pública: `alt` do banco, dimensões gravadas (sem salto de layout); 404 não quebra o contêiner. */
export function Fotos({ fotos }: { fotos: readonly FotoPublica[] }) {
  if (fotos.length === 0) return null;
  return (
    <ul className={estilos.fotos} aria-label="Fotos do salão">
      {fotos.map((f) => (
        <li key={f.id} className={estilos.moldura}>
          {/* eslint-disable-next-line @next/next/no-img-element -- imagem já reduzida (WebP ≤ 1600 px) servida pela app ou CDN (D-021) */}
          <img src={f.url} alt={f.alt} width={f.largura} height={f.altura} loading="lazy" className={estilos.imagem} />
        </li>
      ))}
    </ul>
  );
}

export function Descricao({ texto }: { texto: string | null }) {
  return texto ? <p className={estilos.descricao}>{texto}</p> : null;
}

export function ListaDeServicos({ servicos }: { servicos: readonly ServicoPublico[] }) {
  if (servicos.length === 0) return null;
  return (
    <section className={estilos.secao} aria-labelledby="secao-servicos">
      <h2 id="secao-servicos">Serviços</h2>
      <ul className={estilos.lista}>
        {servicos.map((s) => (
          <li key={s.id} className={estilos.item}>
            <span>{s.nome}</span>
            <span className={estilos.suave}>
              {formatarDuracao(s.duracaoMin)} · {formatarMoeda(s.precoCentavos)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Equipe({ equipe }: { equipe: readonly ProfissionalPublico[] }) {
  if (equipe.length === 0) return null;
  return (
    <section className={estilos.secao} aria-labelledby="secao-equipe">
      <h2 id="secao-equipe">Equipe</h2>
      <ul className={estilos.chips}>
        {equipe.map((p) => (
          <li key={p.id}>{p.nome}</li>
        ))}
      </ul>
    </section>
  );
}

function Funcionamento({ semana }: { semana: NonNullable<PerfilPublico['funcionamento']> }) {
  return (
    <section className={estilos.secao} aria-labelledby="secao-funcionamento">
      <h2 id="secao-funcionamento">Horário de funcionamento</h2>
      <dl className={estilos.semana}>
        {ORDEM_EXIBICAO_DIAS.map((dia) => {
          const intervalos = semana[dia]?.intervalos ?? [];
          return (
            <div key={dia} className={estilos.grupoDia}>
              <dt>{formatarDiaDaSemana(dia)}</dt>
              <dd>
                {intervalos.length === 0 ? 'Fechado' : intervalos.map((i) => formatarFaixaDeMinutos(i.inicioMin, i.fimMin)).join(' e ')}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function digitos(e164: string): string {
  return e164.replace(/\D/g, '');
}

/** Seções do perfil (RN-3): campo vazio omite a seção; nada interno é exposto. */
export function SecoesDoPerfil({ perfil }: { perfil: PerfilPublico }) {
  const e = perfil.endereco;
  const meios = MEIOS_PAGAMENTO.filter((m) => perfil.meiosPagamento.includes(m.chave));
  const comodidades = COMODIDADES.filter((c) => perfil.comodidades.includes(c.chave));
  const temContato = perfil.telefoneE164 !== null || perfil.whatsappE164 !== null || perfil.instagram !== null;
  return (
    <>
      {perfil.funcionamento ? <Funcionamento semana={perfil.funcionamento} /> : null}
      {e ? (
        <section className={estilos.secao} aria-labelledby="secao-endereco">
          <h2 id="secao-endereco">Endereço</h2>
          <address className={estilos.endereco}>
            {e.logradouro}, {e.numero}
            {e.complemento ? ` – ${e.complemento}` : ''}
            <br />
            {e.bairro} · {e.cidade}/{e.uf} · CEP {formatarCep(e.cep)}
          </address>
        </section>
      ) : null}
      {temContato ? (
        <section className={estilos.secao} aria-labelledby="secao-contato">
          <h2 id="secao-contato">Contato</h2>
          <ul className={estilos.lista}>
            {perfil.telefoneE164 ? (
              <li>
                Telefone: <a href={`tel:${perfil.telefoneE164}`}>{formatarTelefone(perfil.telefoneE164)}</a>
              </li>
            ) : null}
            {perfil.whatsappE164 ? (
              <li>
                WhatsApp:{' '}
                <a href={`https://wa.me/${digitos(perfil.whatsappE164)}`} rel="noopener noreferrer">
                  {formatarTelefone(perfil.whatsappE164)}
                </a>
              </li>
            ) : null}
            {perfil.instagram ? (
              <li>
                Instagram:{' '}
                <a href={`https://www.instagram.com/${encodeURIComponent(perfil.instagram)}`} rel="noopener noreferrer">
                  @{perfil.instagram}
                </a>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
      {meios.length > 0 ? (
        <section className={estilos.secao} aria-labelledby="secao-pagamento">
          <h2 id="secao-pagamento">Formas de pagamento</h2>
          <ul className={estilos.chips}>
            {meios.map((m) => (
              <li key={m.chave}>{m.rotulo}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {comodidades.length > 0 ? (
        <section className={estilos.secao} aria-labelledby="secao-comodidades">
          <h2 id="secao-comodidades">Comodidades</h2>
          <ul className={estilos.chips}>
            {comodidades.map((c) => (
              <li key={c.chave}>{c.rotulo}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
