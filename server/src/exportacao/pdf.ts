/**
 * Exportação em PDF (pdfmake com fontes padrão do PDF — nenhum recurso externo).
 * Valores calculados, complementados e ausentes recebem cores distintas e há
 * legenda ao final; a marca d'água "PRÉVIA" identifica o documento como
 * prévia para conferência profissional.
 */
import PdfPrinter from 'pdfmake';
import type { Bloco, Celula, Documento, Formato } from '../compartilhado/tipos.js';

// Tipos estruturais mínimos da definição de documento do pdfmake.
type Content = Record<string, unknown> | string | Content[];
type TableCell = Record<string, unknown> | string;
type TDocumentDefinitions = Record<string, unknown>;
import { ehVal, textoCelula } from './formatar.js';

const fontes = {
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
};

const COR = { calculado: '#5b3fa6', complementado: '#8a5a00', ausente: '#b42318', xml: '#111827', borda: '#d0d5dd', faixa: '#f2f4f7', grupo: '#e8eefc', titulo: '#1d3b8b' };

function celulaPdf(c: Celula, tipo?: Formato, opts: { bold?: boolean; alinhar?: string } = {}): TableCell {
  const texto = textoCelula(c, tipo);
  const base: Record<string, unknown> = { text: texto, alignment: opts.alinhar === 'dir' ? 'right' : opts.alinhar === 'centro' ? 'center' : 'left', bold: opts.bold };
  if (ehVal(c)) {
    if (c.o === 'ausente') Object.assign(base, { color: COR.ausente, italics: true });
    else if (c.o === 'calculado') base.color = COR.calculado;
    else if (c.o === 'complementado') base.color = COR.complementado;
  }
  return base as TableCell;
}

function camposPdf(b: Bloco): Content {
  const n = b.colunasCampos ?? 3;
  const linhas: TableCell[][] = [];
  const campos = b.campos ?? [];
  for (let i = 0; i < campos.length; i += n) {
    const lin: TableCell[] = [];
    for (let j = 0; j < n; j++) {
      const c = campos[i + j];
      lin.push(
        c
          ? { stack: [{ text: c.rotulo, fontSize: 6.5, color: '#475467' }, celulaPdf(c.val)], margin: [0, 1, 0, 1] }
          : { text: '' },
      );
    }
    linhas.push(lin);
  }
  return {
    table: { widths: Array(n).fill('*'), body: linhas },
    layout: { hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => COR.borda, paddingLeft: () => 3, paddingRight: () => 3 },
    margin: [0, 2, 0, 6],
  };
}

function tabelaPdf(b: Bloco): Content {
  const t = b.tabela!;
  const cab: TableCell[] = t.colunas.map((c) => ({ text: c.rotulo, bold: true, fillColor: COR.faixa, alignment: c.alinhar === 'dir' ? 'right' : 'left' }));
  const corpo: TableCell[][] = t.linhas.map((l) => {
    const destaque = l.tipo === 'total' || l.tipo === 'subtotal';
    if (l.tipo === 'grupo') {
      const texto = t.colunas.map((c) => textoCelula(l.c[c.id] ?? null)).filter((x) => x && x !== '—').join(' — ');
      return [{ text: texto, bold: true, colSpan: t.colunas.length, fillColor: COR.grupo }, ...t.colunas.slice(1).map(() => ({ text: '' }))];
    }
    return t.colunas.map((c) => {
      const cel = l.c[c.id];
      const vazio = cel === undefined || (cel === null && destaque);
      const r = vazio ? { text: '' } : celulaPdf(cel ?? null, c.tipo, { bold: destaque, alinhar: c.alinhar });
      if (destaque) (r as Record<string, unknown>).fillColor = l.tipo === 'total' ? '#e4e7ec' : '#f9fafb';
      return r;
    });
  });
  const widths = t.colunas.map((c) => (['moeda', 'quantidade', 'numero', 'inteiro', 'data'].includes(c.tipo ?? '') ? 'auto' : '*'));
  return {
    table: { headerRows: 1, widths, body: [cab, ...corpo], dontBreakRows: true },
    layout: { hLineWidth: () => 0.3, vLineWidth: () => 0.3, hLineColor: () => COR.borda, vLineColor: () => COR.borda, paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 1.5, paddingBottom: () => 1.5 },
    fontSize: t.colunas.length > 8 ? 6.5 : 7.2,
    margin: [0, 2, 0, 6],
  };
}

function blocoPdf(b: Bloco): Content[] {
  const out: Content[] = [];
  const conteudo: Content[] = [];
  if (b.titulo) conteudo.push({ text: b.titulo, style: 'bloco' });
  if (b.subtitulo) conteudo.push({ text: b.subtitulo, fontSize: 7.5, color: '#475467' });
  if (b.campos?.length) conteudo.push(camposPdf(b));
  if (b.tabela) conteudo.push(tabelaPdf(b));
  for (const n of b.notas ?? []) conteudo.push({ text: n, fontSize: 6.8, italics: true, color: '#475467', margin: [0, 0, 0, 2] });
  if (b.assinaturas?.length) {
    const [declaracao, ...linhas] = b.assinaturas;
    conteudo.push({ text: declaracao, fontSize: 7.5, margin: [0, 8, 0, 14] });
    conteudo.push({
      columns: linhas.map((l) => ({ stack: [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 190, y2: 0, lineWidth: 0.5 }] }, { text: l, fontSize: 7, margin: [0, 2, 0, 0] }] })),
      columnGap: 20,
      margin: [0, 10, 0, 6],
    });
  }
  if (b.destaque === 'recibo' || b.destaque === 'memoria') {
    out.push({
      table: { widths: ['*'], body: [[{ stack: conteudo, margin: [4, 4, 4, 4] }]] },
      layout: { hLineWidth: () => 0.8, vLineWidth: () => 0.8, hLineColor: () => '#98a2b3', vLineColor: () => '#98a2b3' },
      margin: [0, 4, 0, 6],
    });
  } else out.push(...conteudo);
  if (b.quebraPagina && out.length) (out[0] as Record<string, unknown>).pageBreak = 'before';
  return out;
}

export function gerarPdf(doc: Documento): Promise<Buffer> {
  const printer = new PdfPrinter(fontes);
  const paisagem = doc.orientacao === 'paisagem';
  const logo = doc.marca?.logoDataUrl && /^data:image\/(png|jpe?g);base64,/.test(doc.marca.logoDataUrl) ? doc.marca.logoDataUrl : undefined;
  const cabecalhoCampos: Content = {
    table: {
      widths: ['*', '*', '*', '*'],
      body: (() => {
        const lin: TableCell[][] = [];
        for (let i = 0; i < doc.cabecalho.length; i += 4) {
          lin.push(
            [0, 1, 2, 3].map((j) => {
              const c = doc.cabecalho[i + j];
              return c ? { stack: [{ text: c.rotulo, fontSize: 6.5, color: '#475467' }, celulaPdf(c.val, undefined, { bold: true })] } : { text: '' };
            }),
          );
        }
        return lin;
      })(),
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 4],
  };
  const pend: Content[] = [];
  if (doc.pendencias.length) {
    pend.push({ text: `Pendências (${doc.pendencias.length})`, style: 'bloco', pageBreak: 'before' });
    pend.push({
      table: {
        headerRows: 1,
        widths: ['auto', 'auto', 'auto', '*'],
        body: [
          ['Nível', 'Categoria', 'Trabalhador', 'Descrição'].map((t) => ({ text: t, bold: true, fillColor: COR.faixa })),
          ...doc.pendencias.map((p) => [p.nivel, p.categoria.replace(/_/g, ' '), p.nome || p.cpf || '', p.mensagem]),
        ],
      },
      fontSize: 7,
      layout: { hLineWidth: () => 0.3, vLineWidth: () => 0.3, hLineColor: () => COR.borda, vLineColor: () => COR.borda },
    });
  }
  const def: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: paisagem ? 'landscape' : 'portrait',
    pageMargins: [28, 54, 28, 40],
    info: { title: doc.titulo, creator: 'Folha eSocial Local', producer: 'Folha eSocial Local' },
    defaultStyle: { font: 'Helvetica', fontSize: 7.8 },
    watermark: { text: 'PRÉVIA', color: '#98a2b3', opacity: 0.08, bold: true },
    styles: {
      titulo: { fontSize: 13, bold: true, color: COR.titulo },
      bloco: { fontSize: 9, bold: true, color: COR.titulo, margin: [0, 6, 0, 2] },
    },
    header: (pagina: number, total: number) => ({
      margin: [28, 16, 28, 0],
      columns: [
        logo ? { image: logo, fit: [80, 26], width: 90 } : { text: '', width: 1 },
        { stack: [{ text: doc.marca?.nome ?? '', bold: true, fontSize: 8 }, { text: [doc.marca?.documento, doc.marca?.contato].filter(Boolean).join(' · '), fontSize: 6.5, color: '#475467' }], width: '*' },
        { text: `Página ${pagina} de ${total}`, alignment: 'right', fontSize: 7, color: '#475467', width: 90 },
      ],
    }),
    footer: () => ({
      margin: [28, 8, 28, 0],
      text: `PRÉVIA PARA CONFERÊNCIA PROFISSIONAL — não é documento oficial do eSocial · Gerado em ${new Date(doc.geradoEm).toLocaleString('pt-BR')} · Folha eSocial Local`,
      fontSize: 6.5,
      color: '#475467',
      alignment: 'center',
    }),
    content: [
      { text: doc.titulo, style: 'titulo' },
      ...(doc.subtitulo ? [{ text: doc.subtitulo, fontSize: 8, color: '#475467' } as Content] : []),
      { canvas: [{ type: 'line', x1: 0, y1: 2, x2: paisagem ? 786 : 539, y2: 2, lineWidth: 1, lineColor: COR.titulo }], margin: [0, 2, 0, 4] },
      cabecalhoCampos,
      { text: doc.aviso, fontSize: 7, bold: true, color: '#7a2e0e', fillColor: '#fef0c7', margin: [0, 0, 0, 6] },
      ...doc.blocos.flatMap(blocoPdf),
      ...pend,
      {
        margin: [0, 10, 0, 0],
        fontSize: 6.8,
        text: [
          { text: 'Legenda de origem: ', bold: true },
          { text: 'preto = XML importado · ', color: COR.xml },
          { text: 'roxo = calculado pelo sistema (regra/versão na consulta) · ', color: COR.calculado },
          { text: 'marrom = complementado pelo usuário · ', color: COR.complementado },
          { text: '"ausente" = não encontrado nos dados disponíveis · ', color: COR.ausente, italics: true },
          { text: '"—" = não se aplica.' },
        ],
      },
    ],
  };
  return new Promise((resolve, reject) => {
    const pdf = printer.createPdfKitDocument(def as never);
    const partes: Buffer[] = [];
    pdf.on('data', (c: Buffer) => partes.push(c));
    pdf.on('end', () => resolve(Buffer.concat(partes)));
    pdf.on('error', reject);
    pdf.end();
  });
}
