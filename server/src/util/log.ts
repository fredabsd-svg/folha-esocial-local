/**
 * Log mínimo e sem dados pessoais: nunca registra corpo de requisições,
 * conteúdo de XML, nomes, salários ou CPFs. Sequências que parecem CPF/CNPJ
 * são mascaradas por precaução.
 */
type Nivel = 'info' | 'aviso' | 'erro';

let saida: (linha: string) => void = (l) => process.stdout.write(l + '\n');
let silencioso = false;

export function configurarLog(opts: { saida?: (linha: string) => void; silencioso?: boolean }) {
  if (opts.saida) saida = opts.saida;
  if (opts.silencioso !== undefined) silencioso = opts.silencioso;
}

const PADROES = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, // CPF
  /\b[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2}\b/g, // CNPJ (inclusive alfanumérico)
  /\b\d{8,}\b/g, // sequências numéricas longas (raiz de CNPJ, recibos, etc.)
];

export function mascarar(texto: string): string {
  let t = texto;
  for (const p of PADROES) t = t.replace(p, '***');
  return t;
}

function escrever(nivel: Nivel, msg: string, dados?: Record<string, string | number | boolean | undefined>) {
  if (silencioso) return;
  const extra = dados
    ? ' ' +
      Object.entries(dados)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? mascarar(v) : v}`)
        .join(' ')
    : '';
  saida(`${new Date().toISOString()} [${nivel}] ${mascarar(msg)}${extra}`);
}

export const log = {
  info: (m: string, d?: Record<string, string | number | boolean | undefined>) => escrever('info', m, d),
  aviso: (m: string, d?: Record<string, string | number | boolean | undefined>) => escrever('aviso', m, d),
  erro: (m: string, d?: Record<string, string | number | boolean | undefined>) => escrever('erro', m, d),
};
