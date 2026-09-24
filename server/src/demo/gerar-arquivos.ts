/**
 * Gera arquivos de exemplo SINTÉTICOS (sem dados reais) e o mapa de campos.
 *   npm run gerar-exemplos
 * Saída: ../exemplos-sinteticos/ e ../docs/MAPA-DE-CAMPOS.md
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABELAS_PADRAO } from '../calculo/tabelas.js';
import { definicoes } from '../relatorios/registro.js';
import { gerarEventosSinteticos, gerarXmlIsolado, gerarZipSintetico } from './sinteticos.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function principal() {
  const ex = path.join(raiz, 'exemplos-sinteticos');
  mkdirSync(ex, { recursive: true });
  writeFileSync(path.join(ex, 'esocial-download-sintetico.zip'), await gerarZipSintetico());
  const iso = gerarXmlIsolado();
  writeFileSync(path.join(ex, iso.nome), iso.conteudo);
  writeFileSync(
    path.join(ex, 'LEIA-ME.txt'),
    ['Arquivos SINTÉTICOS para teste (nenhum dado real).', '', ...gerarEventosSinteticos().descricao.map((d) => `- ${d}`)].join('\r\n'),
  );

  const docs = path.join(raiz, 'docs');
  mkdirSync(docs, { recursive: true });
  const l: string[] = [
    '# Mapa de campos dos relatórios',
    '',
    'Gerado automaticamente a partir do código (`server/src/relatorios/registro.ts`). A mesma informação aparece na aba **Relatórios › Mapa de campos**.',
    '',
    'Classes de origem: **XML** (veio de um evento importado, com arquivo, evento, Id, recibo e campo), **Calculado** (regra determinística com versão, fórmula e parâmetros), **Complementado** (informado pelo usuário, com origem e data) e **Ausente** (não encontrado — nunca vira zero).',
    '',
  ];
  for (const d of definicoes()) {
    l.push(`## ${d.titulo} (\`${d.tipo}\`)`, '', d.descricao, '', '| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |', '|---|---|---|---|---|---|');
    for (const m of d.mapaCampos) {
      const c = (s?: string) => (s ?? '').replace(/\|/g, '\\|');
      l.push(`| ${c(m.campo)} | ${m.classe} | ${c(m.eventos)} | ${m.caminho ? '`' + c(m.caminho) + '`' : ''} | ${c(m.regra)} | ${c(m.observacao)} |`);
    }
    l.push('');
  }
  l.push('## Tabelas legais em uso (padrão)', '', `Versão ${TABELAS_PADRAO.versao}, conferida em ${TABELAS_PADRAO.atualizadoEm}.`, '');
  for (const t of TABELAS_PADRAO.inss) l.push(`- ${t.id} (${t.vigenciaInicio} a ${t.vigenciaFim ?? 'atual'}): teto R$ ${t.teto.toFixed(2)} — ${t.fonte}`);
  for (const t of TABELAS_PADRAO.irrf) l.push(`- ${t.id} (${t.vigenciaInicio} a ${t.vigenciaFim ?? 'atual'}): dependente R$ ${t.deducaoDependente.toFixed(2)}, simplificado R$ ${t.descontoSimplificado.toFixed(2)}${t.reducao ? ', com redutor da Lei 15.270/2025' : ''} — ${t.fonte}`);
  for (const t of TABELAS_PADRAO.salarioMinimo) l.push(`- ${t.id}: R$ ${t.valor.toFixed(2)} — ${t.fonte}`);
  writeFileSync(path.join(docs, 'MAPA-DE-CAMPOS.md'), l.join('\n'));
  console.log(`Exemplos em ${ex}\nMapa de campos em ${path.join(docs, 'MAPA-DE-CAMPOS.md')}`);
}

principal();
