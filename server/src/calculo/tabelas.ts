/**
 * Tabelas legais com vigência, versão e fonte.
 *
 * Os valores padrão abaixo foram conferidos na data indicada em `conferidoEm`.
 * O usuário pode importar um conjunto atualizado (Configurações > Tabelas),
 * que substitui este padrão sem alterar o código. Competências sem tabela
 * cadastrada geram cálculo "incompleto" — o sistema nunca extrapola tabelas.
 */

export interface FaixaInss {
  ate: number;
  aliquota: number;
}

export interface TabelaInss {
  id: string;
  versao: string;
  vigenciaInicio: string; // AAAA-MM
  vigenciaFim?: string | null;
  teto: number;
  faixas: FaixaInss[];
  fonte: string;
  conferidoEm?: string;
}

export interface FaixaIrrf {
  ate: number | null;
  aliquota: number;
  deducao: number;
}

export interface ReducaoIrrf {
  limiteIsencao: number;
  limiteReducao: number;
  constante: number;
  coeficiente: number;
  reducaoMaxima: number;
  aplicaAo13: boolean;
  fonte: string;
}

export interface TabelaIrrf {
  id: string;
  versao: string;
  vigenciaInicio: string;
  vigenciaFim?: string | null;
  faixas: FaixaIrrf[];
  deducaoDependente: number;
  descontoSimplificado: number;
  dispensaRetencaoAte: number;
  reducao?: ReducaoIrrf | null;
  fonte: string;
  conferidoEm?: string;
}

export interface TabelaFgts {
  id: string;
  versao: string;
  vigenciaInicio: string;
  vigenciaFim?: string | null;
  aliquota: number;
  aliquotaAprendiz: number;
  multaSemJustaCausa: number;
  multaAcordo: number;
  fonte: string;
}

export interface TabelaValor {
  id: string;
  versao: string;
  vigenciaInicio: string;
  vigenciaFim?: string | null;
  valor: number;
  fonte: string;
  conferidoEm?: string;
}

export interface RegraAvisoPrevio {
  id: string;
  versao: string;
  diasBase: number;
  diasPorAno: number;
  maximo: number;
  fonte: string;
}

export interface ConjuntoTabelas {
  versao: string;
  atualizadoEm: string;
  origem: 'padrao' | 'personalizado';
  observacao?: string;
  inss: TabelaInss[];
  irrf: TabelaIrrf[];
  fgts: TabelaFgts[];
  salarioMinimo: TabelaValor[];
  avisoPrevio: RegraAvisoPrevio;
  toleranciaConferencia: number;
}

export const TABELAS_PADRAO: ConjuntoTabelas = {
  versao: '2026.1',
  atualizadoEm: '2026-08-28',
  origem: 'padrao',
  observacao:
    'Valores conferidos em fonte oficial até 28/08/2026. Atualize quando houver nova portaria/lei (INSS e salário mínimo: janeiro).',
  inss: [
    {
      id: 'INSS-2024',
      versao: '1',
      vigenciaInicio: '2024-01',
      vigenciaFim: '2024-12',
      teto: 7786.02,
      faixas: [
        { ate: 1412.0, aliquota: 0.075 },
        { ate: 2666.68, aliquota: 0.09 },
        { ate: 4000.03, aliquota: 0.12 },
        { ate: 7786.02, aliquota: 0.14 },
      ],
      fonte: 'Portaria Interministerial MPS/MF nº 2, de 11/01/2024',
    },
    {
      id: 'INSS-2025',
      versao: '1',
      vigenciaInicio: '2025-01',
      vigenciaFim: '2025-12',
      teto: 8157.41,
      faixas: [
        { ate: 1518.0, aliquota: 0.075 },
        { ate: 2793.88, aliquota: 0.09 },
        { ate: 4190.83, aliquota: 0.12 },
        { ate: 8157.41, aliquota: 0.14 },
      ],
      fonte: 'Portaria Interministerial MPS/MF nº 6, de 10/01/2025',
    },
    {
      id: 'INSS-2026',
      versao: '1',
      vigenciaInicio: '2026-01',
      vigenciaFim: null,
      teto: 8475.55,
      faixas: [
        { ate: 1621.0, aliquota: 0.075 },
        { ate: 2902.84, aliquota: 0.09 },
        { ate: 4354.27, aliquota: 0.12 },
        { ate: 8475.55, aliquota: 0.14 },
      ],
      fonte: 'Portaria Interministerial MPS/MF nº 13, de 09/01/2026',
      conferidoEm: '2026-08-28',
    },
  ],
  irrf: [
    {
      id: 'IRRF-2024-02',
      versao: '1',
      vigenciaInicio: '2024-02',
      vigenciaFim: '2025-04',
      faixas: [
        { ate: 2259.2, aliquota: 0, deducao: 0 },
        { ate: 2826.65, aliquota: 0.075, deducao: 169.44 },
        { ate: 3751.05, aliquota: 0.15, deducao: 381.44 },
        { ate: 4664.68, aliquota: 0.225, deducao: 662.77 },
        { ate: null, aliquota: 0.275, deducao: 896.0 },
      ],
      deducaoDependente: 189.59,
      descontoSimplificado: 564.8,
      dispensaRetencaoAte: 10,
      reducao: null,
      fonte: 'Lei nº 9.250/1995, com a tabela da Lei nº 14.848/2024; dispensa de retenção: Lei nº 9.430/1996, art. 67',
    },
    {
      id: 'IRRF-2025-05',
      versao: '1',
      vigenciaInicio: '2025-05',
      vigenciaFim: '2025-12',
      faixas: [
        { ate: 2428.8, aliquota: 0, deducao: 0 },
        { ate: 2826.65, aliquota: 0.075, deducao: 182.16 },
        { ate: 3751.05, aliquota: 0.15, deducao: 394.16 },
        { ate: 4664.68, aliquota: 0.225, deducao: 675.49 },
        { ate: null, aliquota: 0.275, deducao: 908.73 },
      ],
      deducaoDependente: 189.59,
      descontoSimplificado: 607.2,
      dispensaRetencaoAte: 10,
      reducao: null,
      fonte: 'Lei nº 9.250/1995, com a tabela da Lei nº 15.191/2025 (MP nº 1.294/2025); Lei nº 9.430/1996, art. 67',
    },
    {
      id: 'IRRF-2026-01',
      versao: '1',
      vigenciaInicio: '2026-01',
      vigenciaFim: null,
      faixas: [
        { ate: 2428.8, aliquota: 0, deducao: 0 },
        { ate: 2826.65, aliquota: 0.075, deducao: 182.16 },
        { ate: 3751.05, aliquota: 0.15, deducao: 394.16 },
        { ate: 4664.68, aliquota: 0.225, deducao: 675.49 },
        { ate: null, aliquota: 0.275, deducao: 908.73 },
      ],
      deducaoDependente: 189.59,
      descontoSimplificado: 607.2,
      dispensaRetencaoAte: 10,
      reducao: {
        limiteIsencao: 5000,
        limiteReducao: 7350,
        constante: 978.62,
        coeficiente: 0.133145,
        reducaoMaxima: 312.89,
        aplicaAo13: true,
        fonte: 'Lei nº 15.270/2025 (art. 3º-A da Lei nº 9.250/1995); orientação da RFB de 11/12/2025',
      },
      fonte: 'Lei nº 9.250/1995 (tabela da Lei nº 15.191/2025) e Lei nº 15.270/2025; Lei nº 9.430/1996, art. 67',
      conferidoEm: '2026-08-28',
    },
  ],
  fgts: [
    {
      id: 'FGTS',
      versao: '1',
      vigenciaInicio: '2000-01',
      vigenciaFim: null,
      aliquota: 0.08,
      aliquotaAprendiz: 0.02,
      multaSemJustaCausa: 0.4,
      multaAcordo: 0.2,
      fonte: 'Lei nº 8.036/1990, arts. 15 e 18; CLT, art. 484-A',
    },
  ],
  salarioMinimo: [
    {
      id: 'SM-2025',
      versao: '1',
      vigenciaInicio: '2025-01',
      vigenciaFim: '2025-12',
      valor: 1518.0,
      fonte: 'Decreto nº 12.342/2024',
    },
    {
      id: 'SM-2026',
      versao: '1',
      vigenciaInicio: '2026-01',
      vigenciaFim: null,
      valor: 1621.0,
      fonte: 'Decreto federal de dezembro/2025 (conferir o número do decreto)',
      conferidoEm: '2026-08-28',
    },
  ],
  avisoPrevio: {
    id: 'AVISO-PROPORCIONAL',
    versao: '1',
    diasBase: 30,
    diasPorAno: 3,
    maximo: 90,
    fonte: 'CLT, art. 487; Lei nº 12.506/2011',
  },
  toleranciaConferencia: 0.01,
};

function vigente<T extends { vigenciaInicio: string; vigenciaFim?: string | null }>(
  lista: T[],
  competencia: string,
): T | undefined {
  const c = competencia.slice(0, 7);
  return lista.find((t) => t.vigenciaInicio <= c && (!t.vigenciaFim || t.vigenciaFim >= c));
}

export class Tabelas {
  constructor(readonly conjunto: ConjuntoTabelas) {}
  inss(competencia: string) {
    return vigente(this.conjunto.inss, competencia);
  }
  irrf(competencia: string) {
    return vigente(this.conjunto.irrf, competencia);
  }
  fgts(competencia: string) {
    return vigente(this.conjunto.fgts, competencia);
  }
  salarioMinimo(competencia: string) {
    return vigente(this.conjunto.salarioMinimo, competencia);
  }
  get aviso() {
    return this.conjunto.avisoPrevio;
  }
  get tolerancia() {
    return this.conjunto.toleranciaConferencia;
  }
}

/** Validação estrutural de um conjunto importado pelo usuário. */
export function validarConjunto(obj: unknown): { ok: true; conjunto: ConjuntoTabelas } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  const o = obj as Partial<ConjuntoTabelas>;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const comp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);
  if (!o || typeof o !== 'object') return { ok: false, erros: ['Conteúdo não é um objeto JSON.'] };
  if (!Array.isArray(o.inss) || !o.inss.length) erros.push('inss: lista obrigatória.');
  if (!Array.isArray(o.irrf) || !o.irrf.length) erros.push('irrf: lista obrigatória.');
  if (!Array.isArray(o.fgts) || !o.fgts.length) erros.push('fgts: lista obrigatória.');
  if (!Array.isArray(o.salarioMinimo)) erros.push('salarioMinimo: lista obrigatória.');
  for (const t of o.inss ?? []) {
    if (!t.id || !comp(t.vigenciaInicio) || !num(t.teto) || !Array.isArray(t.faixas) || !t.fonte) {
      erros.push(`inss ${t.id ?? '?'}: campos id, vigenciaInicio (AAAA-MM), teto, faixas e fonte são obrigatórios.`);
    } else if (t.faixas.some((f) => !num(f.ate) || !num(f.aliquota) || f.aliquota > 1)) {
      erros.push(`inss ${t.id}: faixas inválidas.`);
    }
  }
  for (const t of o.irrf ?? []) {
    if (!t.id || !comp(t.vigenciaInicio) || !Array.isArray(t.faixas) || !t.fonte || !num(t.deducaoDependente)) {
      erros.push(`irrf ${t.id ?? '?'}: campos id, vigenciaInicio, faixas, deducaoDependente e fonte são obrigatórios.`);
    }
  }
  for (const t of o.fgts ?? []) {
    if (!t.id || !comp(t.vigenciaInicio) || !num(t.aliquota) || !t.fonte) erros.push(`fgts ${t.id ?? '?'}: inválido.`);
  }
  if (!o.avisoPrevio || !num(o.avisoPrevio.diasBase)) erros.push('avisoPrevio: obrigatório.');
  if (erros.length) return { ok: false, erros };
  return {
    ok: true,
    conjunto: {
      ...(o as ConjuntoTabelas),
      origem: 'personalizado',
      toleranciaConferencia: num(o.toleranciaConferencia) ? o.toleranciaConferencia! : 0.01,
      versao: String(o.versao ?? 'personalizado'),
      atualizadoEm: String(o.atualizadoEm ?? new Date().toISOString().slice(0, 10)),
    },
  };
}
