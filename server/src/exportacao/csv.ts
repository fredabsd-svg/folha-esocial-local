import type { Documento } from '../compartilhado/tipos.js';
import { descreverOrigem, ehVal, ROTULO_ORIGEM, textoCelula } from './formatar.js';

const esc = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * CSV com separador ";" e vírgula decimal (padrão do Excel em pt-BR), UTF-8 com BOM.
 * Cada tabela do relatório é exportada com seu cabeçalho; cada coluna de valor
 * ganha uma coluna "(origem)" com a classificação XML/Calculado/Complementado/Ausente.
 */
export function gerarCsv(doc: Documento, comOrigem = true): Buffer {
  const linhas: string[] = [];
  const add = (cols: string[]) => linhas.push(cols.map(esc).join(';'));
  add([doc.titulo]);
  for (const c of doc.cabecalho) add([c.rotulo, textoCelula(c.val)]);
  add([doc.aviso]);
  linhas.push('');
  for (const b of doc.blocos) {
    if (b.titulo) add([b.titulo]);
    if (b.campos?.length) {
      add(['Campo', 'Valor', ...(comOrigem ? ['Origem', 'Detalhe da origem'] : [])]);
      for (const c of b.campos) {
        add([c.rotulo, textoCelula(c.val), ...(comOrigem ? (ehVal(c.val) ? [ROTULO_ORIGEM[c.val.o], descreverOrigem(c.val)] : ['', '']) : [])]);
      }
    }
    if (b.tabela) {
      const cab: string[] = [];
      for (const col of b.tabela.colunas) {
        cab.push(col.rotulo);
        if (comOrigem) cab.push(`${col.rotulo} (origem)`);
      }
      add(['Tipo de linha', ...cab]);
      for (const l of b.tabela.linhas) {
        const vals: string[] = [];
        for (const col of b.tabela.colunas) {
          const cel = l.c[col.id] ?? null;
          vals.push(cel === null && l.tipo && l.tipo !== 'dados' ? '' : textoCelula(cel, col.tipo));
          if (comOrigem) vals.push(ehVal(cel) ? ROTULO_ORIGEM[cel.o] : '');
        }
        add([l.tipo ?? 'dados', ...vals]);
      }
    }
    for (const n of b.notas ?? []) add([n]);
    linhas.push('');
  }
  if (doc.pendencias.length) {
    add(['Pendências']);
    add(['Nível', 'Categoria', 'Trabalhador', 'Competência', 'Descrição']);
    for (const p of doc.pendencias) add([p.nivel, p.categoria, p.nome ?? p.cpf ?? '', p.competencia ?? '', p.mensagem]);
  }
  return Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(linhas.join('\r\n'), 'utf8')]);
}
