/**
 * 4. Mapeamento dos dados para cada relatório; 6. exportação e apresentação.
 */
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { Celula, Documento, Val } from '../src/compartilhado/tipos.js';
import { TRABALHADORES_SINTETICOS } from '../src/demo/sinteticos.js';
import { gerarCsv } from '../src/exportacao/csv.js';
import { gerarPdf } from '../src/exportacao/pdf.js';
import { gerarXlsx } from '../src/exportacao/xlsx.js';
import { definicoes, RELATORIOS } from '../src/relatorios/registro.js';
import { exportarDocumento, gerarDocumento } from '../src/servicos/relatorios.js';
import { armComDemo, EMPRESA } from './apoio.js';

const ehVal = (c: Celula | undefined): c is Val => !!c && typeof c === 'object';

function todosValores(doc: Documento): Val[] {
  const r: Val[] = [];
  for (const c of doc.cabecalho) if (ehVal(c.val)) r.push(c.val);
  for (const b of doc.blocos) {
    for (const c of b.campos ?? []) if (ehVal(c.val)) r.push(c.val);
    for (const l of b.tabela?.linhas ?? []) for (const c of Object.values(l.c)) if (ehVal(c)) r.push(c);
  }
  return r;
}

function paramsPara(tipo: string) {
  const def = RELATORIOS.find((r) => r.tipo === tipo)!;
  if (def.parametros.some((p) => p.tipo === 'periodo')) return { empresa: EMPRESA, perIni: '2026-06', perFim: '2026-08' };
  return { empresa: EMPRESA, competencia: tipo === 'ferias' ? '2026-07' : '2026-08' };
}

describe('mapeamento e origem dos dados', () => {
  it('todos os relatórios de referência e adicionais são gerados, com mapa de campos', async () => {
    const { arm } = await armComDemo();
    const tipos = definicoes().map((d) => d.tipo);
    expect(tipos).toEqual(
      expect.arrayContaining(['extrato', 'movimentos', 'recibo', 'liquidos', 'resumo', 'ferias', 'rescisao', 'admissoes_desligamentos', 'remuneracoes_pagamentos', 'rubricas_competencia', 'eventos_ausentes', 'divergencias']),
    );
    for (const d of definicoes()) {
      expect(d.mapaCampos.length).toBeGreaterThan(0);
      const doc = gerarDocumento(arm, d.tipo, paramsPara(d.tipo));
      expect(doc.aviso).toMatch(/PRÉVIA PARA CONFERÊNCIA PROFISSIONAL/);
      expect(doc.blocos.length).toBeGreaterThan(0);
      // todo valor tem origem válida; valores do XML apontam evento e campo; calculados trazem regra e versão
      for (const v of todosValores(doc)) {
        expect(['xml', 'calculado', 'complementado', 'ausente']).toContain(v.o);
        if (v.o === 'xml' && v.x) {
          expect(v.x.eventoId).toMatch(/^ID/);
          expect(v.x.campo).toBeTruthy();
        }
        if (v.o === 'calculado') expect(v.c?.regra && v.c.versao && v.c.formula).toBeTruthy();
        if (v.o === 'ausente') expect(v.v).toBeNull();
      }
    }
    arm.fechar();
  });

  it('extrato: salário vem do S-2206 vigente e a razão social fica ausente até ser complementada', async () => {
    const { arm } = await armComDemo();
    const doc = gerarDocumento(arm, 'extrato', { empresa: EMPRESA, competencia: '2026-08', trabalhador: 'M001' });
    const campos = doc.blocos[0].campos!;
    const sal = campos.find((c) => c.rotulo === 'Salário contratual')!.val as Val;
    expect(sal).toMatchObject({ v: 3200, o: 'xml' });
    expect(sal.x?.tipoEvento).toBe('S-2206');
    expect(sal.x?.campo).toBe('evtAltContratual/altContratual/infoContrato/remuneracao/vrSalFx');
    expect(doc.empresa.nome.o).toBe('ausente');
    expect(doc.empresa.nome.comp?.campo).toBe('razao_social');
    arm.db
      .prepare("INSERT INTO complementos (emp_chave, escopo, referencia, campo, valor, origem, informado_em) VALUES (?, 'empresa', ?, 'razao_social', 'Empresa Teste', 'Contrato social', ?)")
      .run(EMPRESA, EMPRESA, new Date().toISOString());
    const doc2 = gerarDocumento(arm, 'extrato', { empresa: EMPRESA, competencia: '2026-08', trabalhador: 'M001' });
    expect(doc2.empresa.nome).toMatchObject({ v: 'Empresa Teste', o: 'complementado' });
    expect(doc2.empresa.nome.m?.origem).toBe('Contrato social');
    arm.fechar();
  });

  it('relação de líquidos: usa o S-1210 e sinaliza quando recorre ao cálculo', async () => {
    const { arm } = await armComDemo();
    const doc = gerarDocumento(arm, 'liquidos', { empresa: EMPRESA, competencia: '2026-08' });
    const linhas = doc.blocos[0].tabela!.linhas.filter((l) => !l.tipo);
    const w4 = linhas.find((l) => (l.c.mat as string) === 'M004')!;
    expect(w4.c.origem).toMatch(/S-1210 ausente/);
    expect((w4.c.liq as Val).o).toBe('calculado');
    const total = doc.blocos[0].tabela!.linhas.find((l) => l.tipo === 'total')!;
    expect(String(total.c.nome)).toMatch(/4 pessoa/);
    arm.fechar();
  });

  it('férias: período aquisitivo e gozo do S-2230; data do aviso ausente e complementável', async () => {
    const { arm } = await armComDemo();
    const doc = gerarDocumento(arm, 'ferias', { empresa: EMPRESA, competencia: '2026-07' });
    const aviso = doc.blocos[0].campos!;
    expect((aviso.find((c) => c.rotulo === 'Período aquisitivo')!.val as Val).v).toBe('15/08/2024 a 14/08/2025');
    expect((aviso.find((c) => c.rotulo === 'Dias de gozo')!.val as Val).v).toBe(20);
    const dataAviso = aviso.find((c) => c.rotulo === 'Data do aviso')!.val as Val;
    expect(dataAviso.o).toBe('ausente');
    expect(dataAviso.comp?.escopo).toBe('ferias');
    arm.fechar();
  });

  it('rescisão: memória de cálculo confere com as verbas do XML e pede o saldo do FGTS', async () => {
    const { arm } = await armComDemo();
    const doc = gerarDocumento(arm, 'rescisao', { empresa: EMPRESA, competencia: '2026-08' });
    const mem = doc.blocos.find((b) => b.destaque === 'memoria')!.tabela!.linhas;
    const sit = (item: string) => mem.find((l) => l.c.item === item)?.c.sit;
    expect(sit('Aviso prévio indenizado')).toBe('Confere');
    expect(sit('Saldo de salário')).toBe('Confere');
    expect(sit('13º salário proporcional')).toBe('Confere');
    expect(sit('Férias proporcionais + 1/3')).toBe('Confere');
    expect(sit('Multa rescisória do FGTS (40%)')).toBe('Aguardando complemento');
    expect(doc.pendencias.some((p) => /Saldo do FGTS/.test(p.mensagem))).toBe(true);
    arm.fechar();
  });

  it('eventos ausentes: aponta competência sem S-1299 e S-1210 faltante', async () => {
    const { arm } = await armComDemo();
    const doc = gerarDocumento(arm, 'eventos_ausentes', { empresa: EMPRESA, competencia: '2026-08' });
    const msgs = doc.pendencias.map((p) => p.mensagem).join('\n');
    expect(msgs).toMatch(/S-1299/);
    expect(msgs).toMatch(/Pagamento \(S-1210\)/);
    arm.fechar();
  });

  it('mascara CPF quando solicitado', async () => {
    const { arm } = await armComDemo();
    const doc = gerarDocumento(arm, 'liquidos', { empresa: EMPRESA, competencia: '2026-08', mascararCpf: true });
    const cpfs = doc.blocos[0].tabela!.linhas.filter((l) => !l.tipo).map((l) => (l.c.cpf as Val).v as string);
    for (const c of cpfs) expect(c).toMatch(/^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
    arm.fechar();
  });
});

describe('exportação', () => {
  it('gera PDF, XLSX (com abas de origem e pendências) e CSV', async () => {
    const { arm } = await armComDemo();
    const doc = gerarDocumento(arm, 'extrato', { empresa: EMPRESA, competencia: '2026-08' });
    const pdf = await gerarPdf(doc);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const xlsx = await gerarXlsx(doc);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Relatório', 'Origem dos dados', 'Pendências']);
    expect(wb.getWorksheet('Origem dos dados')!.rowCount).toBeGreaterThan(50);
    const csv = gerarCsv(doc).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(';');
    expect(csv).toMatch(/Extrato mensal da folha/);
    expect(csv).toMatch(/3\.200,00/);
    arm.fechar();
  });

  it('registra a exportação no histórico e guarda o arquivo cifrado', async () => {
    const { arm } = await armComDemo();
    const r = await exportarDocumento(arm, 'recibo', { empresa: EMPRESA, competencia: '2026-08' }, 'pdf');
    const salvo = await arm.lerRelatorio(r.id);
    expect(salvo.equals(r.buf)).toBe(true);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const bruto = fs.readFileSync(path.join(arm.dir, 'relatorios', `${r.id}.bin`));
    expect(bruto.subarray(0, 4).toString()).toBe('FXE1');
    expect(bruto.includes(Buffer.from(TRABALHADORES_SINTETICOS[0].nome))).toBe(false);
    arm.fechar();
  });
});
