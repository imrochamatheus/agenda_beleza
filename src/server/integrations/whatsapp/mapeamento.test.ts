import { describe, expect, it } from 'vitest';

import type { ConfigWhatsAppReal } from './ambiente';
import {
  caminhoDeEnvio,
  classificarResposta,
  CODIGOS_ERRO_WHATSAPP,
  LIMITE_PARAMETRO,
  montarCorpo,
  normalizarParametro,
  ORDEM_PARAMETROS,
  somenteDigitos,
} from './mapeamento';
import { ErroEnvioPermanente, MODELOS_WHATSAPP } from './port';

const CONFIG: ConfigWhatsAppReal = {
  accessToken: 'tok',
  phoneNumberId: '1098765',
  versaoApi: 'v25.0',
  idioma: 'pt_BR',
  modelos: { confirmacao: 'm_conf', remarcacao: 'm_rem', cancelamento: 'm_canc', convite_avaliacao: 'm_conv' },
};
const ITENS = '09:00 Escova com Ana; 10:00 Hidratação com Bia';
const BASE = { salao: 'Studio Aurora', servicos: 'Corte e escova', profissional: 'Marina', data: '12/12/2026', horario: '14:30', itens: ITENS, link: 'https://x.com.br/a/b' };
const e = (modelo: (typeof MODELOS_WHATSAPP)[number], parametros: Record<string, string> = BASE) => ({
  destinatarioE164: '+5511987654321',
  modelo,
  parametros,
  chaveIdempotencia: 'r:t:0',
});
const erro = (status: number, code?: number) => ({
  status,
  texto: JSON.stringify(code === undefined ? { error: {} } : { error: { code, message: 'segredo-da-meta' } }),
});

describe('montarCorpo (CA-1/CA-2)', () => {
  it('a ordem cobre exatamente os modelos da porta', () => {
    expect(Object.keys(ORDEM_PARAMETROS).sort()).toEqual([...MODELOS_WHATSAPP].sort());
    expect(Object.keys(CONFIG.modelos).sort()).toEqual([...MODELOS_WHATSAPP].sort());
  });

  it.each([
    ['confirmacao', 'm_conf', ['Studio Aurora', '12/12/2026', ITENS]],
    ['remarcacao', 'm_rem', ['Studio Aurora', 'Corte e escova', 'Marina', '12/12/2026', '14:30']],
    ['cancelamento', 'm_canc', ['Studio Aurora', 'Corte e escova', '12/12/2026', '14:30']],
    ['convite_avaliacao', 'm_conv', ['Studio Aurora', 'https://x.com.br/a/b']],
  ] as const)('%s: nome, idioma, `to` só dígitos e parâmetros na ordem', (modelo, nome, textos) => {
    expect(montarCorpo(CONFIG, e(modelo))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511987654321',
      type: 'template',
      template: {
        name: nome,
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: textos.map((text) => ({ type: 'text', text })) }],
      },
    });
  });

  it('D-050 CA-43: confirmação consolidada só com salao, data e itens, nessa ordem', () => {
    expect(ORDEM_PARAMETROS.confirmacao).toEqual(['salao', 'data', 'itens']);
    const c = montarCorpo(CONFIG, e('confirmacao', { salao: 'S', data: '01/12/2026', itens: 'linha\num; dois' }));
    expect(c.template.components[0].parameters.map((p) => p.text)).toEqual(['S', '01/12/2026', 'linha um; dois']);
    const longo = montarCorpo(CONFIG, e('confirmacao', { salao: 'S', data: 'd', itens: 'x'.repeat(2000) }));
    expect(Array.from(longo.template.components[0].parameters[2].text)).toHaveLength(LIMITE_PARAMETRO);
    expect(longo.template.components[0].parameters[2].text.endsWith('…')).toBe(true);
  });

  it('ignora chaves extras; profissional vazio vai como "-"', () => {
    const c = montarCorpo(CONFIG, e('remarcacao', { ...BASE, profissional: '', extra: 'x' }));
    expect(c.template.components[0].parameters.map((p) => p.text)).toEqual([
      'Studio Aurora', 'Corte e escova', '-', '12/12/2026', '14:30',
    ]);
  });

  it('parâmetro ausente (inclusive herdado do protótipo) é permanente parametro_ausente', () => {
    const sem: Record<string, string> = { ...BASE };
    delete sem.salao;
    for (const p of [sem, { ...BASE, horario: undefined as unknown as string }, Object.create(BASE) as Record<string, string>]) {
      const r = (() => {
        try {
          return montarCorpo(CONFIG, e('remarcacao', p));
        } catch (x) {
          return x;
        }
      })();
      expect(r).toBeInstanceOf(ErroEnvioPermanente);
      expect((r as ErroEnvioPermanente).codigo).toBe('parametro_ausente');
    }
    // D-050: a confirmação sem `itens` também é recusada antes de qualquer rede.
    const semItens: Record<string, string> = { ...BASE };
    delete semItens.itens;
    expect(() => montarCorpo(CONFIG, e('confirmacao', semItens))).toThrow(ErroEnvioPermanente);
  });

  it('caminho: /{versão}/{phone-number-id}/messages; somenteDigitos', () => {
    expect(caminhoDeEnvio(CONFIG)).toBe('/v25.0/1098765/messages');
    expect(somenteDigitos('+55 (11) 98765-4321')).toBe('5511987654321');
  });
});

describe('normalizarParametro', () => {
  it('troca \\n, \\t e \\r por espaço, colapsa espaços e apara', () => {
    expect(normalizarParametro('  a\nb\t\tc\r\nd     e  ')).toBe('a b c d e');
  });

  it('vazio ou só espaços vira "-"', () => {
    expect(normalizarParametro('')).toBe('-');
    expect(normalizarParametro(' \n\t ')).toBe('-');
  });

  it('trunca em 1024 code points com "…" sem partir um par substituto', () => {
    const exato = 'a'.repeat(LIMITE_PARAMETRO);
    expect(normalizarParametro(exato)).toBe(exato);
    const longo = '😀'.repeat(LIMITE_PARAMETRO + 5);
    const t = normalizarParametro(longo);
    const pontos = Array.from(t);
    expect(pontos).toHaveLength(LIMITE_PARAMETRO);
    expect(pontos.at(-1)).toBe('…');
    expect(pontos.slice(0, -1).every((p) => p === '😀')).toBe(true);
    expect(t.isWellFormed()).toBe(true);
  });
});

describe('classificarResposta: sucesso (CA-3)', () => {
  it('2xx com messages[0].id', () => {
    expect(classificarResposta({ status: 200, texto: JSON.stringify({ messages: [{ id: 'wamid.X' }] }) })).toEqual({
      tipo: 'sucesso',
      id: 'wamid.X',
    });
  });

  it('message_status paused com id continua sucesso', () => {
    const texto = JSON.stringify({ messages: [{ id: 'wamid.Y', message_status: 'paused' }] });
    expect(classificarResposta({ status: 200, texto })).toEqual({ tipo: 'sucesso', id: 'wamid.Y' });
  });

  it.each(['', 'não é json', '{}', '[]', 'null', '{"messages":[]}', '{"messages":[{}]}', '{"messages":[{"id":""}]}', '{"messages":[{"id":7}]}', '{"messages":[null]}', '{"messages":"x"}'])(
    '2xx sem id válido (%j) é temporário resposta_invalida',
    (texto) => {
      expect(classificarResposta({ status: 200, texto })).toEqual({ tipo: 'temporario', codigo: 'resposta_invalida' });
    },
  );
});

describe('classificarResposta: erros (CA-4/CA-5)', () => {
  const casos: [number, 'temporario' | 'permanente', string][] = [
    ...([4, 80007, 130429, 131048, 131056].map((c) => [c, 'temporario', 'limite_de_taxa']) as [number, 'temporario', string][]),
    ...([1, 2, 131000, 131016, 131057, 133004].map((c) => [c, 'temporario', 'provedor_indisponivel']) as [number, 'temporario', string][]),
    ...([0, 10, 190, 200, 250, 299, 131005, 368, 131031, 131037, 131042, 131045].map((c) => [c, 'temporario', 'configuracao_invalida']) as [number, 'temporario', string][]),
    [131026, 'permanente', 'numero_invalido'],
    [131030, 'permanente', 'destinatario_recusado'],
    [131021, 'permanente', 'destinatario_recusado'],
    [131049, 'permanente', 'nao_entregue'],
    [130472, 'permanente', 'nao_entregue'],
    ...([132001, 132015, 132016, 132007].map((c) => [c, 'permanente', 'modelo_invalido']) as [number, 'permanente', string][]),
    ...([132000, 132005, 132012, 131008, 131009].map((c) => [c, 'permanente', 'parametros_invalidos']) as [number, 'permanente', string][]),
    ...([100, 131047, 131051, 135000, 999999].map((c) => [c, 'permanente', 'requisicao_invalida']) as [number, 'permanente', string][]),
  ];

  it.each(casos)('HTTP 400 com error.code %i é %s (%s)', (code, tipo, codigo) => {
    expect(classificarResposta(erro(400, code))).toEqual({ tipo, codigo });
  });

  it('o error.code vale mesmo com HTTP 401/403/404 (o código vem primeiro)', () => {
    expect(classificarResposta(erro(401, 190))).toEqual({ tipo: 'temporario', codigo: 'configuracao_invalida' });
    expect(classificarResposta(erro(403, 131026))).toEqual({ tipo: 'permanente', codigo: 'numero_invalido' });
    expect(classificarResposta(erro(404, 132001))).toEqual({ tipo: 'permanente', codigo: 'modelo_invalido' });
  });

  it('5xx e 429 vencem o error.code (mesmo que seja permanente ou ilegível)', () => {
    for (const s of [500, 502, 503]) {
      expect(classificarResposta(erro(s, 131026))).toEqual({ tipo: 'temporario', codigo: 'provedor_indisponivel' });
      expect(classificarResposta({ status: s, texto: '<html>' })).toEqual({ tipo: 'temporario', codigo: 'provedor_indisponivel' });
    }
    expect(classificarResposta(erro(429, 132000))).toEqual({ tipo: 'temporario', codigo: 'limite_de_taxa' });
    expect(classificarResposta({ status: 429, texto: '' })).toEqual({ tipo: 'temporario', codigo: 'limite_de_taxa' });
  });

  it('sem error.code legível: HTTP é a reserva', () => {
    for (const texto of ['', 'texto', '{}', '[]', 'null', '{"error":null}', '{"error":{"code":"190"}}', '{"error":{"code":1.5}}']) {
      expect(classificarResposta({ status: 401, texto }), texto).toEqual({ tipo: 'temporario', codigo: 'configuracao_invalida' });
    }
    expect(classificarResposta({ status: 403, texto: '' })).toEqual({ tipo: 'temporario', codigo: 'configuracao_invalida' });
    expect(classificarResposta({ status: 400, texto: '' })).toEqual({ tipo: 'permanente', codigo: 'requisicao_invalida' });
    expect(classificarResposta({ status: 404, texto: '{}' })).toEqual({ tipo: 'permanente', codigo: 'requisicao_invalida' });
  });

  it('401/403 com código desconhecido é configuracao_invalida; 400 desconhecido, requisicao_invalida', () => {
    expect(classificarResposta(erro(401, 424242))).toEqual({ tipo: 'temporario', codigo: 'configuracao_invalida' });
    expect(classificarResposta(erro(400, 424242))).toEqual({ tipo: 'permanente', codigo: 'requisicao_invalida' });
  });

  it('3xx e demais são temporários resposta_inesperada', () => {
    for (const s of [301, 302, 307, 308, 100]) {
      expect(classificarResposta({ status: s, texto: '' })).toEqual({ tipo: 'temporario', codigo: 'resposta_inesperada' });
    }
  });

  it('todo `codigo` produzido está na lista fechada e casa ^[a-z0-9_]+$', () => {
    const produzidos = new Set<string>();
    for (const [code] of casos) produzidos.add((classificarResposta(erro(400, code)) as { codigo: string }).codigo);
    for (const s of [301, 500, 429, 401, 400]) produzidos.add((classificarResposta({ status: s, texto: '' }) as { codigo: string }).codigo);
    produzidos.add((classificarResposta({ status: 200, texto: '' }) as { codigo: string }).codigo);
    for (const c of produzidos) {
      expect(CODIGOS_ERRO_WHATSAPP as readonly string[]).toContain(c);
      expect(c).toMatch(/^[a-z0-9_]+$/);
    }
    expect(CODIGOS_ERRO_WHATSAPP.every((c) => /^[a-z0-9_]+$/.test(c))).toBe(true);
  });

  it('a mensagem de erro da Meta nunca entra no resultado', () => {
    expect(JSON.stringify(classificarResposta(erro(400, 131026)))).not.toContain('segredo-da-meta');
  });
});
