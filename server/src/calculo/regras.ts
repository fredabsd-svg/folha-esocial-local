/**
 * Regras de cálculo determinísticas, versionadas e documentadas.
 *
 * Cada função devolve o valor e a memória de cálculo. Nenhum valor é
 * "adivinhado": se falta um dado necessário, o resultado vem marcado como
 * incompleto, com a lista do que falta.
 */
import type { RefCalculo } from '../compartilhado/tipos.js';
import type { Tabelas } from './tabelas.js';

export interface Resultado {
  valor: number | null;
  ref: RefCalculo;
}

// ------------------------------------------------------------------ números
/**
 * Converte para centavos com arredondamento "meio para cima" (afastando do zero),
 * eliminando o ruído de ponto flutuante (ex.: 1621 × 0,075 = 121,57499999… → 121,58).
 */
export const cent = (v: number) => {
  const s = Math.sign(v);
  const oitoCasas = Math.round(Math.abs(v) * 1e8);
  return s * Math.round(oitoCasas / 1e6);
};
export const arred = (v: number) => cent(v) / 100;
/** Trunca em centavos (despreza a terceira casa em diante), sem ruído de ponto flutuante. */
export const truncar = (v: number) => {
  const s = Math.sign(v);
  const oitoCasas = Math.round(Math.abs(v) * 1e8);
  return (s * Math.floor(oitoCasas / 1e6)) / 100;
};
export const somar = (vs: Array<number | null | undefined>) =>
  vs.reduce<number>((a, v) => a + (v == null ? 0 : cent(v)), 0) / 100;

export const fmtMoeda = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ------------------------------------------------------------------ datas
export function data(s: string): Date {
  const [a, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export function somarDias(s: string, dias: number): string {
  const d = data(s);
  d.setUTCDate(d.getUTCDate() + dias);
  return iso(d);
}
export function diasEntre(ini: string, fim: string): number {
  return Math.round((data(fim).getTime() - data(ini).getTime()) / 86_400_000);
}
export function ultimoDiaMes(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number);
  return iso(new Date(Date.UTC(a, m, 0)));
}
export function somarMeses(s: string, meses: number): string {
  const d = data(s);
  const dia = d.getUTCDate();
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1));
  const ult = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ult));
  return iso(alvo);
}
export function anosCompletos(ini: string, fim: string): number {
  const a = data(ini);
  const b = data(fim);
  let anos = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) {
    anos--;
  }
  return Math.max(0, anos);
}
export function competenciaAnterior(c: string, n = 1): string {
  return somarMeses(`${c}-01`, -n).slice(0, 7);
}
export function competenciaSeguinte(c: string, n = 1): string {
  return somarMeses(`${c}-01`, n).slice(0, 7);
}

const tab = (t?: { id: string; versao: string; fonte: string }) =>
  t ? { id: t.id, versao: t.versao, fonte: t.fonte } : undefined;

// ------------------------------------------------------------------ totais
export const REGRA_TOTAIS = { id: 'TOTAIS_DEMONSTRATIVO', versao: '1' };

export function totalPorTipo(
  itens: Array<{ valor: number | null; tpRubr?: string | null }>,
  tipo: '1' | '2' | '3',
): Resultado {
  const sel = itens.filter((i) => (tipo === '3' ? i.tpRubr === '3' || i.tpRubr === '4' : i.tpRubr === tipo));
  const semTipo = itens.filter((i) => !i.tpRubr).length;
  const nome = tipo === '1' ? 'proventos' : tipo === '2' ? 'descontos' : 'informativas';
  return {
    valor: somar(sel.map((i) => i.valor)),
    ref: {
      regra: REGRA_TOTAIS.id,
      versao: REGRA_TOTAIS.versao,
      formula: `Σ vrRubr das rubricas com tpRubr = ${tipo === '3' ? '3 ou 4' : tipo} (${nome})`,
      parametros: { rubricas: sel.length },
      incompleto: semTipo
        ? [`${semTipo} rubrica(s) sem S-1010 importado: tipo (provento/desconto) desconhecido`]
        : undefined,
    },
  };
}

export function liquido(proventos: Resultado, descontos: Resultado): Resultado {
  const incompleto = [...(proventos.ref.incompleto ?? []), ...(descontos.ref.incompleto ?? [])];
  return {
    valor: incompleto.length ? null : somar([proventos.valor, -(descontos.valor ?? 0)]),
    ref: {
      regra: 'LIQUIDO',
      versao: '1',
      formula: 'Total de proventos − total de descontos (rubricas informativas não entram)',
      parametros: { proventos: proventos.valor, descontos: descontos.valor },
      incompleto: incompleto.length ? [...new Set(incompleto)] : undefined,
    },
  };
}

// ------------------------------------------------------------------ bases por incidência
export interface ItemIncidencia {
  valor: number | null;
  tpRubr?: string | null;
  codInc?: string | null;
}

export function basePorIncidencia(itens: ItemIncidencia[], codigos: string[], rotulo: string, regra: string): Resultado {
  let total = 0;
  let semInfo = 0;
  let n = 0;
  for (const i of itens) {
    if (i.codInc == null || i.tpRubr == null) {
      semInfo++;
      continue;
    }
    if (!codigos.includes(i.codInc) || i.valor == null) continue;
    if (i.tpRubr === '1') total += cent(i.valor);
    else if (i.tpRubr === '2') total -= cent(i.valor);
    else continue;
    n++;
  }
  return {
    valor: total / 100,
    ref: {
      regra,
      versao: '1',
      formula: `Σ proventos − Σ descontos das rubricas com incidência ${codigos.join('/')} (${rotulo})`,
      parametros: { rubricas: n },
      incompleto: semInfo ? [`${semInfo} rubrica(s) sem S-1010: incidência desconhecida`] : undefined,
    },
  };
}

export const somaPorIncidencia = (itens: ItemIncidencia[], codigos: string[]) =>
  somar(itens.filter((i) => i.codInc && codigos.includes(i.codInc)).map((i) => i.valor));

// ------------------------------------------------------------------ INSS
export function calcularInss(base: number, competencia: string, tabelas: Tabelas): Resultado {
  const t = tabelas.inss(competencia);
  if (!t) {
    return {
      valor: null,
      ref: {
        regra: 'INSS_PROGRESSIVO',
        versao: '1',
        formula: 'Contribuição progressiva do segurado empregado',
        incompleto: [`Tabela do INSS não cadastrada para ${competencia}`],
      },
    };
  }
  const limitada = Math.min(base, t.teto);
  let anterior = 0;
  const parcelas: number[] = [];
  const memoria: RefCalculo['memoria'] = [];
  for (const f of t.faixas) {
    if (limitada <= anterior) break;
    const parcela = Math.min(limitada, f.ate) - anterior;
    // o eSocial (S-5001, vrCpSeg) trunca a contribuição de cada faixa em centavos
    const v = truncar(parcela * f.aliquota);
    parcelas.push(v);
    memoria.push({
      descricao: `Faixa até ${fmtMoeda(f.ate)}: ${fmtMoeda(parcela)} × ${(f.aliquota * 100).toFixed(1).replace('.', ',')}% (truncado em centavos)`,
      valor: v,
    });
    anterior = f.ate;
  }
  return {
    valor: somar(parcelas),
    ref: {
      regra: 'INSS_PROGRESSIVO',
      versao: '2',
      formula: 'Σ (parcela da base em cada faixa × alíquota da faixa, truncado em centavos), base limitada ao teto — mesmo critério do vrCpSeg do S-5001',
      parametros: { base: arred(base), teto: t.teto, baseLimitada: arred(limitada) },
      tabela: tab(t),
      memoria,
    },
  };
}

// ------------------------------------------------------------------ IRRF
export type TipoIrrf = 'mensal' | 'ferias' | '13';

export interface EntradaIrrf {
  competencia: string;
  tipo: TipoIrrf;
  rendimentos: number;
  previdenciaOficial: number;
  pensao: number;
  previdenciaPrivada: number;
  dependentes: number | null;
}

export function calcularIrrf(e: EntradaIrrf, tabelas: Tabelas): Resultado {
  const t = tabelas.irrf(e.competencia);
  const incompleto: string[] = [];
  const base: RefCalculo = {
    regra: 'IRRF_PROGRESSIVO',
    versao: '1',
    formula:
      'Base = rendimentos − maior entre (deduções legais) e (desconto simplificado, só no mensal); ' +
      'IR = base × alíquota − parcela a deduzir; redutor da Lei 15.270/2025 quando vigente; ' +
      'dispensa de retenção de valor até R$ 10,00',
  };
  if (!t) {
    return { valor: null, ref: { ...base, incompleto: [`Tabela do IRRF não cadastrada para ${e.competencia}`] } };
  }
  if (e.dependentes == null) incompleto.push('Quantidade de dependentes para IRRF não encontrada (S-2200/S-2205 ausente)');
  const deps = (e.dependentes ?? 0) * t.deducaoDependente;
  const legais = e.previdenciaOficial + e.pensao + e.previdenciaPrivada + deps;
  const simplificado = e.tipo === 'mensal' ? t.descontoSimplificado : 0;
  const usaSimplificado = simplificado > legais;
  const deducao = usaSimplificado ? simplificado : legais;
  const bc = Math.max(0, e.rendimentos - deducao);
  const faixa = t.faixas.find((f) => f.ate == null || bc <= f.ate)!;
  let imposto = Math.max(0, bc * faixa.aliquota - faixa.deducao);
  const memoria: RefCalculo['memoria'] = [
    { descricao: 'Rendimentos tributáveis', valor: arred(e.rendimentos) },
    { descricao: 'Previdência oficial', valor: arred(e.previdenciaOficial) },
    { descricao: 'Pensão alimentícia', valor: arred(e.pensao) },
    { descricao: 'Previdência privada', valor: arred(e.previdenciaPrivada) },
    { descricao: `Dependentes (${e.dependentes ?? '?'} × ${fmtMoeda(t.deducaoDependente)})`, valor: arred(deps) },
    {
      descricao: usaSimplificado ? 'Dedução aplicada: desconto simplificado' : 'Dedução aplicada: deduções legais',
      valor: arred(deducao),
    },
    { descricao: 'Base de cálculo', valor: arred(bc) },
    {
      descricao: `Faixa: ${(faixa.aliquota * 100).toFixed(1).replace('.', ',')}% − ${fmtMoeda(faixa.deducao)}`,
      valor: arred(imposto),
    },
  ];
  let reducao = 0;
  const r = t.reducao;
  if (r && (e.tipo === 'mensal' || (e.tipo === '13' && r.aplicaAo13))) {
    if (e.rendimentos <= r.limiteIsencao) reducao = Math.min(imposto, r.reducaoMaxima);
    else if (e.rendimentos <= r.limiteReducao) {
      reducao = Math.min(imposto, Math.max(0, r.constante - r.coeficiente * e.rendimentos));
    }
    memoria.push({ descricao: 'Redutor (Lei 15.270/2025)', valor: arred(reducao) });
  } else if (r && e.tipo === 'ferias') {
    incompleto.push('Aplicação do redutor da Lei 15.270/2025 às férias pagas em separado: conferir orientação da RFB');
  }
  imposto = Math.max(0, imposto - reducao);
  if (imposto > 0 && imposto <= t.dispensaRetencaoAte) {
    memoria.push({ descricao: `Dispensa de retenção (≤ ${fmtMoeda(t.dispensaRetencaoAte)})`, valor: 0 });
    imposto = 0;
  }
  return {
    valor: arred(imposto),
    ref: {
      ...base,
      parametros: {
        tipo: e.tipo,
        rendimentos: arred(e.rendimentos),
        dependentes: e.dependentes,
        baseCalculo: arred(bc),
        aliquota: faixa.aliquota,
        parcelaDeduzir: faixa.deducao,
      },
      tabela: tab(t),
      memoria,
      incompleto: incompleto.length ? incompleto : undefined,
    },
  };
}

// ------------------------------------------------------------------ FGTS
export function calcularFgts(base: number, codCateg: string | null | undefined, competencia: string, tabelas: Tabelas): Resultado {
  const t = tabelas.fgts(competencia);
  if (!t) {
    return { valor: null, ref: { regra: 'FGTS_DEPOSITO', versao: '1', formula: 'base × alíquota', incompleto: ['Tabela do FGTS ausente'] } };
  }
  const aprendiz = codCateg === '103';
  const aliq = aprendiz ? t.aliquotaAprendiz : t.aliquota;
  return {
    valor: arred(base * aliq),
    ref: {
      regra: 'FGTS_DEPOSITO',
      versao: '1',
      formula: `Base do FGTS × ${(aliq * 100).toFixed(0)}%${aprendiz ? ' (aprendiz)' : ''}`,
      parametros: { base: arred(base), aliquota: aliq, codCateg: codCateg ?? null },
      tabela: tab(t),
    },
  };
}

// ------------------------------------------------------------------ rescisão / férias
export function avisoPrevioProporcional(dtAdm: string, dtDeslig: string, tabelas: Tabelas): Resultado {
  const a = tabelas.aviso;
  const anos = anosCompletos(dtAdm, dtDeslig);
  const dias = Math.min(a.maximo, a.diasBase + a.diasPorAno * anos);
  return {
    valor: dias,
    ref: {
      regra: 'AVISO_PROPORCIONAL',
      versao: a.versao,
      formula: `${a.diasBase} dias + ${a.diasPorAno} dias por ano completo de serviço (máximo ${a.maximo})`,
      parametros: { admissao: dtAdm, desligamento: dtDeslig, anosCompletos: anos },
      tabela: { id: a.id, versao: a.versao, fonte: a.fonte },
    },
  };
}

export function avos13(inicio: string, fim: string, ano: number): Resultado {
  let avos = 0;
  const memoria: RefCalculo['memoria'] = [];
  for (let m = 1; m <= 12; m++) {
    const ini = `${ano}-${String(m).padStart(2, '0')}-01`;
    const fimMes = ultimoDiaMes(ini.slice(0, 7));
    const s = inicio > ini ? inicio : ini;
    const e = fim < fimMes ? fim : fimMes;
    if (e < s) continue;
    const dias = diasEntre(s, e) + 1;
    if (dias >= 15) avos++;
    memoria.push({ descricao: `${String(m).padStart(2, '0')}/${ano}: ${dias} dia(s)`, valor: dias >= 15 ? 1 : 0 });
  }
  return {
    valor: avos,
    ref: {
      regra: 'AVOS_13',
      versao: '1',
      formula: 'Meses do ano com 15 dias ou mais de trabalho (inclui projeção do aviso indenizado)',
      parametros: { inicio, fim, ano },
      memoria,
      incompleto: ['Afastamentos e faltas que reduzem avos não são considerados automaticamente'],
    },
  };
}

export function avosFerias(inicioPeriodo: string, fim: string): Resultado {
  let avos = 0;
  for (let k = 0; k < 12; k++) {
    const ini = somarMeses(inicioPeriodo, k);
    const fimMes = somarDias(somarMeses(inicioPeriodo, k + 1), -1);
    if (fimMes <= fim) {
      avos++;
      continue;
    }
    if (ini <= fim && diasEntre(ini, fim) + 1 >= 15) avos++;
    break;
  }
  return {
    valor: avos,
    ref: {
      regra: 'AVOS_FERIAS',
      versao: '1',
      formula: 'Meses completos do período aquisitivo em curso; fração de 15 dias ou mais conta 1/12',
      parametros: { inicioPeriodoAquisitivo: inicioPeriodo, fim },
      incompleto: ['Faltas injustificadas no período aquisitivo (art. 130 da CLT) não constam nos XMLs'],
    },
  };
}

export function saldoSalario(salarioMensal: number, dtDeslig: string, dtAdm?: string | null): Resultado {
  const comp = dtDeslig.slice(0, 7);
  const inicio = dtAdm && dtAdm.slice(0, 7) === comp ? dtAdm : `${comp}-01`;
  const dias = Math.min(30, diasEntre(inicio, dtDeslig) + 1);
  return {
    valor: arred((salarioMensal / 30) * dias),
    ref: {
      regra: 'SALDO_SALARIO',
      versao: '1',
      formula: 'Salário mensal ÷ 30 × dias trabalhados no mês do desligamento (limitado a 30)',
      parametros: { salarioMensal, dias, inicio, desligamento: dtDeslig },
    },
  };
}

export function proporcional(salarioMensal: number, avos: number, comTerco: boolean, regra: string, descricao: string): Resultado {
  const bruto = (salarioMensal / 12) * avos;
  return {
    valor: arred(comTerco ? bruto * (4 / 3) : bruto),
    ref: {
      regra,
      versao: '1',
      formula: `${descricao}: salário ÷ 12 × avos${comTerco ? ' × 4/3 (acréscimo de 1/3)' : ''}`,
      parametros: { salarioMensal, avos },
      incompleto: ['Médias de verbas variáveis não constam nos XMLs (informe como complemento)'],
    },
  };
}

export interface Comparacao {
  status: 'ok' | 'arredondamento' | 'divergente' | 'incompleto' | 'sem_referencia';
  diferenca: number | null;
}

export function comparar(calculado: number | null, informado: number | null, tolerancia: number, incompleto?: boolean): Comparacao {
  if (informado == null) return { status: 'sem_referencia', diferenca: null };
  if (calculado == null) return { status: 'incompleto', diferenca: null };
  const dif = arred(informado - calculado);
  if (Math.abs(dif) <= tolerancia) return { status: 'ok', diferenca: dif };
  if (Math.abs(dif) <= 0.05) return { status: 'arredondamento', diferenca: dif };
  return { status: incompleto ? 'incompleto' : 'divergente', diferenca: dif };
}
