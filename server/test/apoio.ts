import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { carregarConfig } from '../src/config.js';
import { Armazenamento } from '../src/db/armazenamento.js';
import { gerarZipSintetico } from '../src/demo/sinteticos.js';
import { importarArquivo } from '../src/importacao/importador.js';
import { configurarLog } from '../src/util/log.js';

configurarLog({ silencioso: true });

export const EMPRESA = '1:98765432';

const criados: string[] = [];
process.on('exit', () => {
  for (const d of criados) limpar(d);
});

export function dirTemporario() {
  const d = mkdtempSync(path.join(os.tmpdir(), 'folha-teste-'));
  criados.push(d);
  return d;
}

export async function abrirArmazenamento(dir = dirTemporario()) {
  return Armazenamento.abrir({ dadosDir: dir, modoChave: 'arquivo' });
}

export const cfgTeste = () => carregarConfig({ dadosDir: dirTemporario(), modoChave: 'arquivo', abrirNavegador: false, porta: 0 });

export async function armComDemo() {
  const arm = await abrirArmazenamento();
  const cfg = cfgTeste();
  const resumo = await importarArquivo(arm, cfg, { nomeArquivo: 'demo.zip', dados: await gerarZipSintetico(), origem: 'demonstracao' });
  return { arm, cfg, resumo };
}

export function limpar(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows pode manter o arquivo aberto por instantes */
  }
}
