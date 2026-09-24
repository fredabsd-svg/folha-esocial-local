/**
 * Exportação em XLSX: aba do relatório, aba "Origem dos dados" (rastreabilidade
 * de cada valor) e aba "Pendências". Números são gravados como números.
 */
import ExcelJS from 'exceljs';
import type { Celula, Documento, Formato } from '../compartilhado/tipos.js';
import { descreverOrigem, ehVal, numeroCelula, ROTULO_ORIGEM, textoCelula } from './formatar.js';

const FORMATO_NUM: Partial<Record<Formato, string>> = {
  moeda: '#,##0.00',
  numero: '#,##0.####',
  quantidade: '#,##0.##',
  inteiro: '0',
  percentual: '0.00%',
};

export async function gerarXlsx(doc: Documento): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Folha eSocial Local';
  wb.created = new Date(doc.geradoEm);
  const ws = wb.addWorksheet('Relatório', { views: [{ showGridLines: false }] });
  const origem = wb.addWorksheet('Origem dos dados');
  origem.columns = [
    { header: 'Bloco', key: 'bloco', width: 30 },
    { header: 'Linha', key: 'linha', width: 8 },
    { header: 'Campo / coluna', key: 'campo', width: 28 },
    { header: 'Valor', key: 'valor', width: 18 },
    { header: 'Origem', key: 'origem', width: 14 },
    { header: 'Evento', key: 'evento', width: 10 },
    { header: 'Id do evento', key: 'id', width: 40 },
    { header: 'Recibo', key: 'recibo', width: 26 },
    { header: 'Campo no XML', key: 'campoXml', width: 50 },
    { header: 'Arquivo', key: 'arquivo', width: 50 },
    { header: 'Regra / fórmula / observação', key: 'regra', width: 80 },
  ];
  origem.getRow(1).font = { bold: true };

  let r = 1;
  const escrever = (valores: Array<string | number | null>, estilo?: Partial<ExcelJS.Style>) => {
    const row = ws.getRow(r++);
    valores.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      if (estilo) Object.assign(cell, { style: { ...cell.style, ...estilo } });
    });
    return row;
  };
  const registrarOrigem = (bloco: string, linha: number, campo: string, c: Celula) => {
    if (!ehVal(c)) return;
    origem.addRow({
      bloco,
      linha,
      campo,
      valor: textoCelula(c),
      origem: ROTULO_ORIGEM[c.o],
      evento: c.x?.tipoEvento ?? '',
      id: c.x?.eventoId ?? '',
      recibo: c.x?.recibo ?? '',
      campoXml: c.x?.campo ?? '',
      arquivo: c.x?.arquivo ?? '',
      regra: c.o === 'xml' ? '' : descreverOrigem(c),
    });
  };
  const gravarCelula = (cell: ExcelJS.Cell, c: Celula, tipo?: Formato) => {
    const n = numeroCelula(c);
    const f = (ehVal(c) ? c.f : undefined) ?? tipo;
    if (n !== null && f && FORMATO_NUM[f]) {
      cell.value = n;
      cell.numFmt = FORMATO_NUM[f]!;
    } else {
      cell.value = textoCelula(c, tipo);
    }
    if (ehVal(c)) {
      if (c.o === 'ausente') cell.font = { italic: true, color: { argb: 'FFB42318' } };
      else if (c.o === 'calculado') cell.font = { color: { argb: 'FF5B3FA6' } };
      else if (c.o === 'complementado') cell.font = { color: { argb: 'FF8A5A00' } };
    }
  };

  escrever([doc.titulo], { font: { bold: true, size: 14, color: { argb: 'FF1D3B8B' } } });
  for (const c of doc.cabecalho) {
    const row = ws.getRow(r++);
    row.getCell(1).value = c.rotulo;
    row.getCell(1).font = { bold: true };
    gravarCelula(row.getCell(2), c.val);
    registrarOrigem('Cabeçalho', row.number, c.rotulo, c.val);
  }
  escrever([doc.aviso], { font: { bold: true, color: { argb: 'FF7A2E0E' } } });
  r++;

  let maxCols = 4;
  doc.blocos.forEach((b, bi) => {
    const nomeBloco = b.titulo ?? `Bloco ${bi + 1}`;
    if (b.titulo) escrever([b.titulo], { font: { bold: true, size: 11, color: { argb: 'FF1D3B8B' } } });
    for (const c of b.campos ?? []) {
      const row = ws.getRow(r++);
      row.getCell(1).value = c.rotulo;
      gravarCelula(row.getCell(2), c.val);
      registrarOrigem(nomeBloco, row.number, c.rotulo, c.val);
    }
    if (b.tabela) {
      const t = b.tabela;
      maxCols = Math.max(maxCols, t.colunas.length);
      const cab = ws.getRow(r++);
      t.colunas.forEach((c, i) => {
        const cell = cab.getCell(i + 1);
        cell.value = c.rotulo;
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F7' } };
        cell.alignment = { horizontal: c.alinhar === 'dir' ? 'right' : 'left', wrapText: true };
      });
      for (const l of t.linhas) {
        const row = ws.getRow(r++);
        const destaque = l.tipo === 'total' || l.tipo === 'subtotal' || l.tipo === 'grupo';
        t.colunas.forEach((c, i) => {
          const cel = l.c[c.id];
          const cell = row.getCell(i + 1);
          if (cel === undefined || (cel === null && destaque)) return;
          gravarCelula(cell, cel ?? null, c.tipo);
          if (destaque) cell.font = { ...(cell.font ?? {}), bold: true };
          if (l.tipo === 'grupo') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEFC' } };
          registrarOrigem(nomeBloco, row.number, c.rotulo, cel ?? null);
        });
      }
    }
    for (const n of b.notas ?? []) escrever([n], { font: { italic: true, color: { argb: 'FF475467' } } });
    for (const a of b.assinaturas ?? []) escrever([a]);
    r++;
  });
  for (let i = 1; i <= maxCols; i++) ws.getColumn(i).width = i === 1 ? 28 : i === 2 ? 34 : 16;

  const pend = wb.addWorksheet('Pendências');
  pend.columns = [
    { header: 'Nível', key: 'nivel', width: 10 },
    { header: 'Categoria', key: 'categoria', width: 20 },
    { header: 'Trabalhador', key: 'trab', width: 34 },
    { header: 'CPF', key: 'cpf', width: 16 },
    { header: 'Competência', key: 'comp', width: 12 },
    { header: 'Descrição', key: 'msg', width: 100 },
  ];
  pend.getRow(1).font = { bold: true };
  for (const p of doc.pendencias) {
    pend.addRow({ nivel: p.nivel, categoria: p.categoria, trab: p.nome ?? '', cpf: p.cpf ?? '', comp: p.competencia ?? '', msg: p.mensagem });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
