import { createHash } from 'node:crypto';
import { TABELAS_PADRAO, type ConjuntoTabelas, Tabelas } from '../calculo/tabelas.js';
import type { Documento, Marca } from '../compartilhado/tipos.js';
import type { Armazenamento } from '../db/armazenamento.js';
import { gerarCsv } from '../exportacao/csv.js';
import { nomeArquivo } from '../exportacao/formatar.js';
import { gerarPdf } from '../exportacao/pdf.js';
import { gerarXlsx } from '../exportacao/xlsx.js';
import { aplicarModelo, criarContexto, ErroParametro, type ModeloRelatorio, type Parametros } from '../relatorios/base.js';
import { obterRelatorio } from '../relatorios/registro.js';

export function tabelasEfetivas(arm: Armazenamento): Tabelas {
  return new Tabelas(arm.obterConfig<ConjuntoTabelas>('tabelas_personalizadas', TABELAS_PADRAO));
}

export function marca(arm: Armazenamento): Marca | undefined {
  return arm.obterConfig<Marca | undefined>('marca', undefined);
}

export function modelo(arm: Armazenamento, tipo: string): ModeloRelatorio | undefined {
  return arm.obterConfig<ModeloRelatorio | undefined>(`modelo:${tipo}`, undefined);
}

const PADRAO_PARAM = /^[\w:.\- áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]*$/;

export function normalizarParametros(bruto: Record<string, unknown>): Parametros {
  const p: Parametros = { empresa: '' };
  for (const [k, v] of Object.entries(bruto ?? {})) {
    if (typeof v === 'boolean') p[k] = v;
    else if (typeof v === 'string') {
      const s = v.trim().slice(0, 120);
      if (!PADRAO_PARAM.test(s)) throw new ErroParametro(`Parâmetro inválido: ${k}`);
      p[k] = s;
    }
  }
  if (!p.empresa || !/^[12]:[0-9A-Z]{8,14}$/.test(p.empresa)) throw new ErroParametro('Selecione a empresa.');
  for (const c of ['competencia', 'perIni', 'perFim'] as const) {
    const v = p[c];
    if (v && !/^\d{4}(-\d{2})?$/.test(v)) throw new ErroParametro(`${c} deve estar no formato AAAA-MM`);
  }
  if (p.perIni && p.perFim && p.perIni > p.perFim) throw new ErroParametro('Período inicial posterior ao final.');
  return p;
}

export function gerarDocumento(arm: Armazenamento, tipo: string, bruto: Record<string, unknown>): Documento {
  const def = obterRelatorio(tipo);
  if (!def) throw new ErroParametro('Relatório desconhecido.');
  const p = normalizarParametros(bruto);
  const mod = modelo(arm, tipo);
  const cx = criarContexto(arm.db, tabelasEfetivas(arm), p, marca(arm), mod);
  return aplicarModelo(def.gerar(cx), mod);
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

export async function exportarDocumento(arm: Armazenamento, tipo: string, bruto: Record<string, unknown>, formato: string) {
  if (!MIME[formato]) throw new ErroParametro('Formato inválido.');
  const doc = gerarDocumento(arm, tipo, bruto);
  const buf = formato === 'pdf' ? await gerarPdf(doc) : formato === 'xlsx' ? await gerarXlsx(doc) : gerarCsv(doc);
  const nome = nomeArquivo(tipo, doc.empresa.chave, doc.competencia ?? (doc.parametros.perIni as string | undefined), formato);
  const id = Number(
    arm.db
      .prepare(
        `INSERT INTO relatorios_gerados (tipo, titulo, formato, emp_chave, competencia, parametros_json, gerado_em, tamanho, sha256, qtd_pendencias, nome_arquivo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tipo,
        doc.titulo,
        formato,
        doc.empresa.chave,
        doc.competencia ?? null,
        JSON.stringify(doc.parametros),
        doc.geradoEm,
        buf.length,
        createHash('sha256').update(buf).digest('hex'),
        doc.pendencias.length,
        nome,
      ).lastInsertRowid,
  );
  await arm.salvarRelatorio(id, buf);
  return { id, buf, nome, mime: MIME[formato] };
}

export { MIME };
