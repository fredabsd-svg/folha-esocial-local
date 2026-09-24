/**
 * Leitura de ZIP em memória, sem extrair nada para o disco.
 *
 * Proteções: nomes com caminho absoluto, "..", letra de unidade ou NUL são
 * rejeitados; limites de quantidade de entradas, tamanho por entrada, tamanho
 * total descompactado, taxa de compressão (zip bomb) e profundidade de ZIPs
 * aninhados.
 */
import yauzl from 'yauzl';

export interface LimitesZip {
  maxEntradas: number;
  maxBytesEntrada: number;
  maxBytesTotal: number;
  maxTaxaCompressao: number;
  maxProfundidade: number;
}

export const LIMITES_ZIP_PADRAO: LimitesZip = {
  maxEntradas: 100_000,
  maxBytesEntrada: 50 * 1024 * 1024,
  maxBytesTotal: 2 * 1024 * 1024 * 1024,
  maxTaxaCompressao: 400,
  maxProfundidade: 3,
};

export type ItemZip =
  | { nome: string; dados: Buffer; erro?: undefined }
  | { nome: string; dados?: undefined; erro: string };

export class ZipRejeitadoError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ZipRejeitadoError';
  }
}

function decodificarNome(bruto: Buffer, utf8: boolean): string {
  return utf8 ? bruto.toString('utf8') : bruto.toString('latin1');
}

/** Retorna motivo da rejeição ou null se o nome for seguro. */
export function validarNomeEntrada(nome: string): string | null {
  if (!nome) return 'nome vazio';
  if (nome.includes('\0')) return 'nome contém caractere nulo';
  const n = nome.replace(/\\/g, '/');
  if (n.startsWith('/')) return 'caminho absoluto não permitido';
  if (/^[a-zA-Z]:/.test(n)) return 'letra de unidade não permitida';
  if (n.split('/').some((p) => p === '..')) return 'caminho com ".." não permitido';
  if (n.length > 1024) return 'nome muito longo';
  return null;
}

function abrir(buf: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buf,
      { lazyEntries: true, decodeStrings: false, validateEntrySizes: true, strictFileNames: false },
      (err, zip) => (err || !zip ? reject(err ?? new Error('ZIP inválido')) : resolve(zip)),
    );
  });
}

function lerEntrada(zip: yauzl.ZipFile, entrada: yauzl.Entry, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entrada, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error('falha ao ler entrada'));
      const partes: Buffer[] = [];
      let total = 0;
      stream.on('data', (c: Buffer) => {
        total += c.length;
        if (total > max) {
          stream.destroy(new ZipRejeitadoError('entrada excede o tamanho máximo permitido'));
          return;
        }
        partes.push(c);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(partes)));
    });
  });
}

export function ehZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05);
}

interface Estado {
  entradas: number;
  bytes: number;
}

/**
 * Percorre o ZIP (e ZIPs internos) entregando cada arquivo com extensão aceita.
 * Entradas problemáticas são entregues com `erro`, sem interromper as demais.
 */
export function lerZip(buf: Buffer, limites: LimitesZip = LIMITES_ZIP_PADRAO, extensoes: string[] = ['xml']) {
  return percorrerZip(buf, limites, extensoes, '', 1, { entradas: 0, bytes: 0 });
}

async function* percorrerZip(
  buf: Buffer,
  limites: LimitesZip,
  extensoes: string[],
  prefixo: string,
  profundidade: number,
  estado: Estado,
): AsyncGenerator<ItemZip> {
  if (profundidade > limites.maxProfundidade) {
    yield { nome: prefixo || '(zip)', erro: 'ZIP aninhado além da profundidade permitida' };
    return;
  }
  let zip: yauzl.ZipFile;
  try {
    zip = await abrir(buf);
  } catch (e) {
    throw new ZipRejeitadoError(`Arquivo ZIP inválido ou corrompido: ${(e as Error).message}`);
  }
  const fila: Array<yauzl.Entry | null> = [];
  let erroZip: Error | null = null;
  let aguardando: (() => void) | null = null;
  const acordar = () => {
    const a = aguardando;
    aguardando = null;
    a?.();
  };
  zip.on('entry', (e: yauzl.Entry) => {
    fila.push(e);
    acordar();
  });
  zip.on('end', () => {
    fila.push(null);
    acordar();
  });
  zip.on('error', (e: Error) => {
    erroZip = e;
    fila.push(null);
    acordar();
  });
  try {
    zip.readEntry();
    while (true) {
      if (!fila.length) await new Promise<void>((r) => (aguardando = r));
      const entrada = fila.shift();
      if (entrada === undefined) continue;
      if (entrada === null) break;
      const nomeBruto = entrada.fileName as unknown as Buffer;
      const utf8 = (entrada.generalPurposeBitFlag & 0x800) !== 0;
      const nome = decodificarNome(Buffer.from(nomeBruto), utf8);
      const nomeCompleto = prefixo ? `${prefixo}/${nome}` : nome;
      estado.entradas++;
      try {
        if (estado.entradas > limites.maxEntradas) {
          throw new ZipRejeitadoError('ZIP excede a quantidade máxima de arquivos permitida');
        }
        if (nome.endsWith('/')) continue; // diretório
        const motivo = validarNomeEntrada(nome);
        if (motivo) {
          yield { nome: nomeCompleto, erro: `Entrada rejeitada: ${motivo}` };
          continue;
        }
        const ext = nome.toLowerCase().split('.').pop() ?? '';
        if (ext !== 'zip' && !extensoes.includes(ext)) {
          yield { nome: nomeCompleto, erro: `Ignorado: extensão não aceita (${extensoes.join(', ')} ou zip)` };
          continue;
        }
        if (entrada.uncompressedSize > limites.maxBytesEntrada) {
          yield { nome: nomeCompleto, erro: 'Entrada excede o tamanho máximo permitido' };
          continue;
        }
        const taxa = entrada.compressedSize > 0 ? entrada.uncompressedSize / entrada.compressedSize : 0;
        if (taxa > limites.maxTaxaCompressao && entrada.uncompressedSize > 1024 * 1024) {
          yield { nome: nomeCompleto, erro: 'Taxa de compressão suspeita (possível "zip bomb")' };
          continue;
        }
        if (estado.bytes + entrada.uncompressedSize > limites.maxBytesTotal) {
          throw new ZipRejeitadoError('ZIP excede o tamanho total descompactado permitido');
        }
        let dados: Buffer;
        try {
          dados = await lerEntrada(zip, entrada, limites.maxBytesEntrada);
        } catch (e) {
          yield { nome: nomeCompleto, erro: `Falha ao descompactar: ${(e as Error).message}` };
          continue;
        }
        estado.bytes += dados.length;
        if (ext === 'zip' || ehZip(dados)) {
          yield* percorrerZip(dados, limites, extensoes, nomeCompleto, profundidade + 1, estado);
        } else {
          yield { nome: nomeCompleto, dados };
        }
      } finally {
        zip.readEntry();
      }
    }
    if (erroZip) throw new ZipRejeitadoError(`Erro na leitura do ZIP: ${(erroZip as Error).message}`);
  } finally {
    zip.close();
  }
}
