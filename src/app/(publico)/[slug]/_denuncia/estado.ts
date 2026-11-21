import type { ErrosDenuncia } from '@/server/denuncias/tipos';

/** Estado do formulário de denúncia (D-035). Sem 'use server'. Sucesso não aparece aqui: é PRG (redirect). */
export type EstadoDenuncia = {
  status: 'inicial' | 'invalido' | 'humano' | 'limitado';
  mensagem: string | null;
  erros: ErrosDenuncia;
  valores: { motivo: string; texto: string };
};

export const ESTADO_INICIAL_DENUNCIA: EstadoDenuncia = {
  status: 'inicial',
  mensagem: null,
  erros: {},
  valores: { motivo: '', texto: '' },
};

export type AcaoDenunciar = (anterior: EstadoDenuncia, formData: FormData) => Promise<EstadoDenuncia>;
