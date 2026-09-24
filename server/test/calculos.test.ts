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
import { montarFolha } from '../src/dominio/folha.js';
import { TRABALHADORES_SINTETICOS } from '../src/demo/sinteticos.js';
import { armComDemo, EMPRESA } from './apoio.js';

const tab = new Tabelas(TABELAS_PADRAO);

describe('INSS progressivo', () => {
  it('confere com a parcela a deduzir da tabela 2026', () => {
    // 3.000,00 × 12% − 111,40 = 248,60
    expect(calcularInss(3000, '2026-08', tab).valor).toBe(248.6);
    expect(calcularInss(1621, '2026-01', tab).valor).toBe(121.58);
    // acima do teto: contribuição máxima 988,09
    expect(calcularInss(20000, '2026-05', tab).valor).toBe(988.09);
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
