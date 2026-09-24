import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ModoChave, modoChavePadrao } from './seguranca/cripto.js';
import { LIMITES_XML_PADRAO, type LimitesXml } from './xml/arvore.js';
import { LIMITES_ZIP_PADRAO, type LimitesZip } from './xml/zip.js';

export interface Config {
  dadosDir: string;
  porta: number;
  host: string;
  modoChave: ModoChave;
  webDir: string;
  dev: boolean;
  abrirNavegador: boolean;
  maxUploadBytes: number;
  limitesXml: LimitesXml;
  limitesZip: LimitesZip;
}

export function dadosDirPadrao(): string {
  if (process.env.FOLHA_DADOS_DIR) return path.resolve(process.env.FOLHA_DADOS_DIR);
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'FolhaESocialLocal');
  }
  return path.join(os.homedir(), '.folha-esocial-local');
}

const aqui = path.dirname(fileURLToPath(import.meta.url));

export function carregarConfig(sobrepor: Partial<Config> = {}): Config {
  const porta = Number(process.env.FOLHA_PORTA ?? 5178);
  return {
    dadosDir: dadosDirPadrao(),
    porta: Number.isInteger(porta) && porta > 0 && porta < 65536 ? porta : 5178,
    host: '127.0.0.1',
    modoChave: modoChavePadrao(),
    webDir: path.resolve(aqui, '..', '..', 'web', 'dist'),
    dev: process.env.FOLHA_DEV === '1',
    abrirNavegador: !process.argv.includes('--sem-navegador') && process.env.FOLHA_SEM_NAVEGADOR !== '1',
    maxUploadBytes: 512 * 1024 * 1024,
    limitesXml: LIMITES_XML_PADRAO,
    limitesZip: LIMITES_ZIP_PADRAO,
    ...sobrepor,
  };
}
