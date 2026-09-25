/**
 * 5. Cálculos determinísticos, totais, líquidos e sinalização de ausentes.
 */
import { describe, expect, it } from 'vitest';
import {
  avisoPrevioProporcional,
  avos13,
  avosFerias,
  calcularFgts,
  calcularInss,
  calcularIrrf,
  comparar,
  liquido,
  saldoSalario,
  totalPorTipo,
} from '../src/calculo/regras.js';
import { TABELAS_PADRAO, Tabelas, validarConjunto } from '../src/calculo/tabelas.js';
import { Dados } from '../src/dominio/dados.js';
import { montarFolha, vxRubricas, type ItemRem } from '../src/dominio/folha.js';
import { TRABALHADORES_SINTETICOS } from '../src/demo/sinteticos.js';
import { armComDemo, EMPRESA } from './apoio.js';

const tab = new Tabelas(TABELAS_PADRAO);

describe('INSS progressivo', () => {
  it('trunca cada faixa em centavos, como o eSocial no S-5001 (vrCpSeg)', () => {
    // 121,575 → 121,57 | 1.281,84 × 9% = 115,3656 → 115,36 | 97,16 × 12% = 11,6592 → 11,65
    expect(calcularInss(3000, '2026-08', tab).valor).toBe(248.58);
    expect(calcularInss(1621, '2026-01', tab).valor).toBe(121.57);
    // acima do teto: 121,57 + 115,36 + 174,17 + 576,97
    expect(calcularInss(20000, '2026-05', tab).valor).toBe(988.07);
    // 2024: 105,90 + 112,92 + 160,00 + 530,03 = 908,85 (contribuição máxima divulgada)
    expect(calcularInss(10000, '2024-03', tab).valor).toBe(908.85);
    const r = calcularInss(3000, '2026-08', tab);
    expect(r.ref.versao).toBe('2');
    expect(r.ref.memoria?.map((m) => m.valor)).toEqual([121.57, 115.36, 11.65]);
  });
  it('usa a tabela vigente na competência e registra fonte e versão', () => {
    const r = calcularInss(3000, '2025-06', tab);
    expect(r.ref.tabela?.id).toBe('INSS-2025');
    expect(r.ref.tabela?.fonte).toMatch(/Portaria/);
  });
  it('não extrapola: sem tabela para a competência, o cálculo fica incompleto (nunca zero)', () => {
    const r = calcularInss(3000, '2019-01', tab);
    expect(r.valor).toBeNull();
    expect(r.ref.incompleto?.[0]).toMatch(/não cadastrada/);
  });
});

describe('valor retido pelas rubricas', () => {
  // férias pagas no mês com gozo no seguinte: INSS "provisionado" (desconto, tipo 2) e o mesmo
  // valor repetido em rubricas informativas (tipos 3 e 4) — o eSocial (vrDescSeg) só soma o desconto
  const item = (cod: string, tp: string, cp: string, v: number) =>
    ({ codRubr: cod, ideTabRubr: 'T', rub: { tp, cp }, vNum: v, valor: { v, o: 'xml', f: 'moeda' } }) as unknown as ItemRem;
  it('soma descontos, subtrai proventos e ignora rubricas informativas', () => {
    const itens = [item('A', '2', '31', 300), item('B', '2', '31', 100.1), item('C', '3', '31', 100.1), item('D', '4', '31', 100.1), item('E', '1', '31', 0.1)];
    const r = vxRubricas(itens, ['31'], 'cp', 'teste');
    expect(r.v).toBe(400);
    expect(r.c?.parametros).toEqual({ rubricasInformativasIgnoradas: 2 });
    expect(vxRubricas([item('C', '3', '31', 50)], ['31'], 'cp', 'teste').o).toBe('ausente');
  });
});

describe('IRRF', () => {
  it('aplica o redutor da Lei 15.270/2025 (exemplo oficial: R$ 6.000 → redução de R$ 179,75)', () => {
    const r = calcularIrrf({ competencia: '2026-03', tipo: 'mensal', rendimentos: 6000, previdenciaOficial: 0, pensao: 0, previdenciaPrivada: 0, dependentes: 0 }, tab);
    const red = r.ref.memoria!.find((m) => String(m.descricao).startsWith('Redutor'));
    expect(red?.valor).toBe(179.75);
    // base 6000 − 607,20 = 5.392,80 → 27,5% − 908,73 = 574,29 − 179,75
    expect(r.valor).toBe(394.54);
  });
  it('zera o imposto até R$ 5.000,00 a partir de 2026', () => {
    const r = calcularIrrf({ competencia: '2026-01', tipo: 'mensal', rendimentos: 5000, previdenciaOficial: 500, pensao: 0, previdenciaPrivada: 0, dependentes: 0 }, tab);
    expect(r.valor).toBe(0);
  });
  it('usa deduções legais quando superiores ao desconto simplificado', () => {
    const r = calcularIrrf({ competencia: '2025-08', tipo: 'mensal', rendimentos: 5000, previdenciaOficial: 500, pensao: 0, previdenciaPrivada: 0, dependentes: 1 }, tab);
    // deduções 500 + 189,59 = 689,59 > 607,20 → base 4.310,41 × 22,5% − 675,49 = 294,35
    expect(r.valor).toBe(294.35);
  });
  it('marca como incompleto quando não se conhecem os dependentes', () => {
    const r = calcularIrrf({ competencia: '2026-01', tipo: 'mensal', rendimentos: 9000, previdenciaOficial: 0, pensao: 0, previdenciaPrivada: 0, dependentes: null }, tab);
    expect(r.ref.incompleto?.join()).toMatch(/dependentes/);
  });
});

describe('FGTS, avos, aviso e saldo', () => {
  it('FGTS 8% e 2% para aprendiz', () => {
    expect(calcularFgts(1000, '101', '2026-01', tab).valor).toBe(80);
    expect(calcularFgts(1000, '103', '2026-01', tab).valor).toBe(20);
  });
  it('aviso prévio proporcional (Lei 12.506/2011)', () => {
    expect(avisoPrevioProporcional('2022-02-01', '2026-08-20', tab).valor).toBe(42);
    expect(avisoPrevioProporcional('2000-01-01', '2026-08-20', tab).valor).toBe(90);
  });
  it('avos de 13º com projeção e avos de férias', () => {
    expect(avos13('2026-01-01', '2026-10-01', 2026).valor).toBe(9);
    expect(avos13('2026-06-10', '2026-12-31', 2026).valor).toBe(7);
    expect(avosFerias('2026-02-01', '2026-10-01').valor).toBe(8);
  });
  it('saldo de salário proporcional aos dias', () => {
    expect(saldoSalario(2200, '2026-08-20').valor).toBe(1466.67);
  });
});

describe('totais e líquidos', () => {
  it('rubrica sem S-1010 deixa o líquido incompleto em vez de assumir zero', () => {
    const itens = [
      { valor: 1000, tpRubr: '1' },
      { valor: 100, tpRubr: '2' },
      { valor: 50, tpRubr: undefined },
    ];
    const l = liquido(totalPorTipo(itens, '1'), totalPorTipo(itens, '2'));
    expect(l.valor).toBeNull();
    expect(l.ref.incompleto?.[0]).toMatch(/S-1010/);
  });
  it('comparação distingue confere, arredondamento e divergência', () => {
    expect(comparar(100, 100, 0.01).status).toBe('ok');
    expect(comparar(100, 100.03, 0.01).status).toBe('arredondamento');
    expect(comparar(100, 110, 0.01).status).toBe('divergente');
    expect(comparar(100, null, 0.01).status).toBe('sem_referencia');
  });

  it('folha sintética: detecta a divergência proposital e o S-1210 ausente', async () => {
    const { arm } = await armComDemo();
    const f = montarFolha(new Dados(arm.db, EMPRESA), tab, '2026-08');
    const [w1, , , w4] = TRABALHADORES_SINTETICOS;
    const t1 = f.find((t) => t.cpf === w1.cpf)!;
    const conf = t1.dms[0].conferenciaLiquido;
    expect(conf.status).toBe('divergente');
    expect(conf.diferenca?.v).toBe(10);
    const t4 = f.find((t) => t.cpf === w4.cpf)!;
    expect(t4.pago.o).toBe('ausente');
    expect(t4.pago.v).toBeNull();
    expect(t4.pendencias.some((p) => p.categoria === 'evento_ausente' && /S-1210/.test(p.mensagem))).toBe(true);
    // aprendiz: FGTS 2% confere com o S-5003
    expect(t4.conferencias.find((c) => c.id === 'fgts')?.status).toBe('ok');
    // todas as conferências de INSS conferem com o S-5001 sintético
    for (const t of f) for (const c of t.conferencias.filter((x) => x.id.startsWith('inss'))) expect(c.status).toBe('ok');
    arm.fechar();
  });
});

describe('tabelas configuráveis', () => {
  it('recusa conjunto sem fonte ou com vigência inválida', () => {
    const r = validarConjunto({ ...TABELAS_PADRAO, inss: [{ id: 'X', vigenciaInicio: '2026', teto: 1, faixas: [], fonte: '' }] });
    expect(r.ok).toBe(false);
  });
  it('aceita conjunto válido e marca como personalizado', () => {
    const r = validarConjunto(structuredClone(TABELAS_PADRAO));
    expect(r.ok && r.conjunto.origem).toBe('personalizado');
  });
});
