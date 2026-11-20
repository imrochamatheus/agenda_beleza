import { formatarCep, formatarTelefone } from '@/lib/format';
import { ehTelefoneBrE164, normalizarTelefoneBr } from '@/lib/telefone';
import { normalizarNome } from '@/lib/texto';
import type { PerfilDTO } from '@/server/repos/tipos';

import { COMODIDADES, filtrarChaves, LIMITES_PERFIL, MEIOS_PAGAMENTO, MENSAGENS_PERFIL, UFS } from './perfil-tipos';
import type { CampoPerfil, Endereco, ErrosPerfil, PerfilSalao, Uf, ValoresPerfil } from './perfil-tipos';

// Validação e normalização do perfil público do salão (D-020 §3.3; RN-4..RN-9). Pura: sem banco nem
// imports de runtime de @/server/** (só `import type`). Reutilizável pela E8.2. Nada aqui lança.

const M = MENSAGENS_PERFIL;
const L = LIMITES_PERFIL;

/** Controle, exceto \n (a descrição já trocou \r e \t antes). */
const CONTROLE_EXCETO_QUEBRA = /[^\P{Cc}\n]/u;

/** RN-5: descrição multilinha. Vazio (ou só espaços) → null. */
export function normalizarDescricao(v: unknown): { ok: true; valor: string | null } | { ok: false; erro: string } {
  if (v === undefined) return { ok: true, valor: null };
  if (typeof v !== 'string' || v.length > L.descricaoMaxBruta) return { ok: false, erro: M.descricao };
  const n = v.replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  if (CONTROLE_EXCETO_QUEBRA.test(n)) return { ok: false, erro: M.descricaoCaracteres };
  const aparada = n.trim();
  if (aparada === '') return { ok: true, valor: null };
  if (aparada.length > L.descricao) return { ok: false, erro: M.descricao };
  return { ok: true, valor: aparada };
}

/** RN-6: `NNNNN-NNN` ou `NNNNNNNN` (já aparado e não vazio) → 8 dígitos; `00000000` e o resto → null. */
export function normalizarCep(v: string): string | null {
  if (!/^\d{5}-?\d{3}$/.test(v)) return null;
  const cep = v.replace('-', '');
  return cep === '00000000' ? null : cep;
}

const PREFIXO_INSTAGRAM = /^(https?:\/\/)?(www\.)?instagram\.com(\/|$)/i;
const USUARIO_INSTAGRAM = /^[a-z0-9._]{1,30}$/;

/**
 * RN-8 (A-11): `perfil`, `@perfil` ou `instagram.com/perfil` (com ou sem `https://`, `www.`, barra final
 * ou `?…`/`#…`, descartados) → nome de usuário em minúsculas. Já aparado e não vazio. Inválido → null.
 * Por regex e split, sem `new URL`.
 */
export function normalizarInstagram(v: string): string | null {
  let usuario: string;
  const prefixo = PREFIXO_INSTAGRAM.exec(v);
  if (prefixo) {
    const caminho = v.slice(prefixo[0].length).split(/[?#]/, 1)[0];
    const segmentos = caminho.split('/').filter((s) => s !== '');
    if (segmentos.length !== 1) return null;
    usuario = segmentos[0];
  } else {
    usuario = v.startsWith('@') ? v.slice(1) : v;
  }
  usuario = usuario.toLowerCase();
  if (!USUARIO_INSTAGRAM.test(usuario)) return null;
  if (usuario.startsWith('.') || usuario.endsWith('.') || usuario.includes('..')) return null;
  return usuario;
}

type CampoLinha = 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade';
type Texto = { ausente: true } | { ausente: false; valor: string } | { erro: string };

/** Texto de uma linha: não-string → erro; vazio depois de aparar → ausente. */
function textoBruto(v: unknown, erro: string, maxBruto: number): { ausente: true } | { texto: string } | { erro: string } {
  if (v === undefined) return { ausente: true };
  if (typeof v !== 'string' || v.length > maxBruto) return { erro };
  const t = v.trim();
  return t === '' ? { ausente: true } : { texto: t };
}

function campoLinha(v: unknown, campo: CampoLinha): Texto {
  const b = textoBruto(v, M[campo], L.textoMaxBruto);
  if ('erro' in b || 'ausente' in b) return b;
  const n = normalizarNome(b.texto, { min: 1, max: L[campo] });
  if (n === null) return { erro: M[campo] };
  return { ausente: false, valor: campo === 'numero' && /^s\/n$/i.test(n) ? 's/n' : n };
}

function campoComRegra(v: unknown, erro: string, maxBruto: number, regra: (t: string) => string | null): Texto {
  const b = textoBruto(v, erro, maxBruto);
  if ('erro' in b || 'ausente' in b) return b;
  const n = regra(b.texto);
  return n === null ? { erro } : { ausente: false, valor: n };
}

function lista<T extends string>(v: unknown, opcoes: readonly { chave: T }[]): { ok: true; chaves: T[] } | { ok: false } {
  if (v === undefined) return { ok: true, chaves: [] };
  if (!Array.isArray(v) || v.length > L.itensListaMax || !v.every((i) => typeof i === 'string')) return { ok: false };
  const conhecidas = new Set<string>(opcoes.map((o) => o.chave));
  if (!v.every((i: string) => conhecidas.has(i))) return { ok: false };
  return { ok: true, chaves: filtrarChaves(opcoes, v) };
}

const ehObjeto = (e: unknown): e is Record<string, unknown> => typeof e === 'object' && e !== null && !Array.isArray(e);

/** RN-4..RN-9. Todos os erros juntos. Entrada que não é objeto → { formulario }. Chaves extras ignoradas. */
export function validarPerfil(e: unknown): { ok: true; perfil: PerfilSalao } | { ok: false; erros: ErrosPerfil } {
  if (!ehObjeto(e)) return { ok: false, erros: { formulario: M.formulario } };
  const erros: ErrosPerfil = {};
  const valor = (campo: CampoPerfil, t: Texto): string | null => {
    if ('erro' in t) {
      erros[campo] = t.erro;
      return null;
    }
    return t.ausente ? null : t.valor;
  };

  const desc = normalizarDescricao(e.descricao);
  if (!desc.ok) erros.descricao = desc.erro;

  const logradouro = campoLinha(e.logradouro, 'logradouro');
  const numero = campoLinha(e.numero, 'numero');
  const complemento = campoLinha(e.complemento, 'complemento');
  const bairro = campoLinha(e.bairro, 'bairro');
  const cidade = campoLinha(e.cidade, 'cidade');
  const uf = campoComRegra(e.uf, M.uf, L.textoMaxBruto, (t) => {
    const u = t.toUpperCase();
    return (UFS as readonly string[]).includes(u) ? u : null;
  });
  const cep = campoComRegra(e.cep, M.cep, L.textoMaxBruto, normalizarCep);

  const blocos = { logradouro, numero, complemento, bairro, cidade, uf, cep } as const;
  // "Preenchido" = algum campo com texto depois de aparar (inclusive os inválidos).
  const preenchido = Object.values(blocos).some((t) => !('ausente' in t && t.ausente));
  const v = Object.fromEntries(Object.entries(blocos).map(([k, t]) => [k, valor(k as CampoPerfil, t)])) as Record<
    keyof typeof blocos,
    string | null
  >;
  if (preenchido) {
    for (const campo of ['logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep'] as const) {
      if (v[campo] === null && erros[campo] === undefined) erros[campo] = M.enderecoObrigatorio;
    }
  }

  const telefone = valor('telefone', campoComRegra(e.telefone, M.telefone, L.textoMaxBruto, normalizarTelefoneBr));
  const whatsapp = valor('whatsapp', campoComRegra(e.whatsapp, M.telefone, L.textoMaxBruto, normalizarTelefoneBr));
  const instagram = valor('instagram', campoComRegra(e.instagram, M.instagram, L.instagramMaxBruto, normalizarInstagram));

  const meios = lista(e.meiosPagamento, MEIOS_PAGAMENTO);
  if (!meios.ok) erros.meiosPagamento = M.lista;
  const comodidades = lista(e.comodidades, COMODIDADES);
  if (!comodidades.ok) erros.comodidades = M.lista;

  if (Object.keys(erros).length > 0 || !desc.ok || !meios.ok || !comodidades.ok) return { ok: false, erros };

  const endereco: Endereco | null = preenchido
    ? {
        logradouro: v.logradouro!,
        numero: v.numero!,
        complemento: v.complemento,
        bairro: v.bairro!,
        cidade: v.cidade!,
        uf: v.uf as Uf,
        cep: v.cep!,
      }
    : null;
  return {
    ok: true,
    perfil: {
      descricao: desc.valor,
      endereco,
      telefoneE164: telefone,
      whatsappE164: whatsapp,
      instagram,
      meiosPagamento: meios.chaves,
      comodidades: comodidades.chaves,
    },
  };
}

/** PerfilSalao → PerfilDTO (colunas). */
export function perfilParaColunas(p: PerfilSalao): PerfilDTO {
  return {
    descricao: p.descricao,
    enderecoLogradouro: p.endereco?.logradouro ?? null,
    enderecoNumero: p.endereco?.numero ?? null,
    enderecoComplemento: p.endereco?.complemento ?? null,
    enderecoBairro: p.endereco?.bairro ?? null,
    enderecoCidade: p.endereco?.cidade ?? null,
    enderecoUf: p.endereco?.uf ?? null,
    enderecoCep: p.endereco?.cep ?? null,
    telefoneE164: p.telefoneE164,
    whatsappE164: p.whatsappE164,
    instagram: p.instagram,
    meiosPagamento: [...p.meiosPagamento],
    comodidades: [...p.comodidades],
  };
}

/** Telefone gravado → exibição; valor fora do formato (não deveria existir) volta cru. */
function telefoneParaTela(v: string | null): string {
  if (v === null) return '';
  return ehTelefoneBrE164(v) ? formatarTelefone(v) : v;
}

/**
 * PerfilDTO (banco) → valores do formulário: telefone por formatarTelefone, CEP por formatarCep e
 * listas por filtrarChaves (chave desconhecida gravada é ignorada, RN-9/CA-15).
 */
export function valoresDoPerfil(p: PerfilDTO): ValoresPerfil {
  const cep = p.enderecoCep ?? '';
  return {
    descricao: p.descricao ?? '',
    logradouro: p.enderecoLogradouro ?? '',
    numero: p.enderecoNumero ?? '',
    complemento: p.enderecoComplemento ?? '',
    bairro: p.enderecoBairro ?? '',
    cidade: p.enderecoCidade ?? '',
    uf: p.enderecoUf ?? '',
    cep: /^\d{8}$/.test(cep) ? formatarCep(cep) : cep,
    telefone: telefoneParaTela(p.telefoneE164),
    whatsapp: telefoneParaTela(p.whatsappE164),
    instagram: p.instagram ?? '',
    meiosPagamento: filtrarChaves(MEIOS_PAGAMENTO, p.meiosPagamento),
    comodidades: filtrarChaves(COMODIDADES, p.comodidades),
  };
}
