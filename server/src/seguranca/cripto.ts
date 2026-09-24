/**
 * Chave-mestra e criptografia dos dados locais.
 *
 * - Windows: a chave-mestra aleatória (32 bytes) é protegida pela DPAPI do
 *   Windows (escopo do usuário atual). Só o mesmo usuário, no mesmo
 *   computador, consegue abri-la.
 * - Outros sistemas (ou FOLHA_CHAVE_MODO=arquivo): arquivo com permissão 0600.
 *
 * Da chave-mestra derivam-se (HKDF-SHA256) as chaves do banco, dos arquivos
 * originais e dos relatórios gerados. Arquivos são cifrados com AES-256-GCM.
 */
import { execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scryptSync } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';

export type ModoChave = 'dpapi' | 'arquivo';

const MAGICO = Buffer.from('FXE1'); // Folha XML eSocial v1

function executarPowerShell(script: string, entrada: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout.trim())),
    );
    p.stdin?.end(entrada);
  });
}

const PS_PROTEGER =
  "Add-Type -AssemblyName System.Security; $i=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($i); $p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($p))";
const PS_ABRIR =
  "Add-Type -AssemblyName System.Security; $i=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($i); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($p))";

export async function dpapiProteger(dados: Buffer): Promise<Buffer> {
  return Buffer.from(await executarPowerShell(PS_PROTEGER, dados.toString('base64')), 'base64');
}

export async function dpapiAbrir(dados: Buffer): Promise<Buffer> {
  return Buffer.from(await executarPowerShell(PS_ABRIR, dados.toString('base64')), 'base64');
}

export function modoChavePadrao(): ModoChave {
  const env = process.env.FOLHA_CHAVE_MODO;
  if (env === 'arquivo' || env === 'dpapi') return env;
  return process.platform === 'win32' ? 'dpapi' : 'arquivo';
}

/** Obtém (ou cria) a chave-mestra no diretório de dados. */
export async function obterChaveMestra(dir: string, modo: ModoChave): Promise<Buffer> {
  const arqDpapi = path.join(dir, 'chave.dpapi');
  const arqLocal = path.join(dir, 'chave.local');
  if (modo === 'dpapi') {
    if (existsSync(arqDpapi)) {
      const chave = await dpapiAbrir(await fs.readFile(arqDpapi));
      if (chave.length !== 32) throw new Error('Chave-mestra inválida.');
      return chave;
    }
    const chave = randomBytes(32);
    await fs.writeFile(arqDpapi, await dpapiProteger(chave), { mode: 0o600 });
    return chave;
  }
  if (existsSync(arqLocal)) {
    const chave = await fs.readFile(arqLocal);
    if (chave.length !== 32) throw new Error('Chave-mestra inválida.');
    return chave;
  }
  const chave = randomBytes(32);
  await fs.writeFile(arqLocal, chave, { mode: 0o600 });
  return chave;
}

export function derivarChave(mestra: Buffer, finalidade: string): Buffer {
  return Buffer.from(hkdfSync('sha256', mestra, Buffer.alloc(0), `folha-esocial:${finalidade}`, 32));
}

export function cifrar(chave: Buffer, dados: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave, iv);
  const corpo = Buffer.concat([c.update(dados), c.final()]);
  return Buffer.concat([MAGICO, iv, c.getAuthTag(), corpo]);
}

export function decifrar(chave: Buffer, pacote: Buffer): Buffer {
  if (pacote.length < 32 || !pacote.subarray(0, 4).equals(MAGICO)) {
    throw new Error('Arquivo cifrado inválido.');
  }
  const iv = pacote.subarray(4, 16);
  const tag = pacote.subarray(16, 32);
  const d = createDecipheriv('aes-256-gcm', chave, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(pacote.subarray(32)), d.final()]);
}

/** Chave derivada de senha (para backups portáteis). A senha nunca é armazenada. */
export function chaveDeSenha(senha: string, sal: Buffer): Buffer {
  return scryptSync(senha.normalize('NFC'), sal, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
