import type { Celula, Formato, Val } from '../../server/src/compartilhado/tipos';

export const ehVal = (c: unknown): c is Val => !!c && typeof c === 'object' && 'o' in (c as object);

export function formatar(v: string | number | null | undefined, f?: Formato): string {
  if (v === null || v === undefined) return '';
  switch (f) {
    case 'moeda':
      return typeof v === 'number' ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
    case 'numero':
    case 'quantidade':
      return typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : String(v);
    case 'percentual':
      return typeof v === 'number' ? `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : String(v);
    case 'data': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
    }
    case 'competencia':
      return competencia(String(v));
    case 'cpf': {
      const s = String(v);
      return /^\d{11}$/.test(s) ? `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}` : s;
    }
    case 'cnpj': {
      const s = String(v).toUpperCase();
      return /^[0-9A-Z]{12}\d{2}$/.test(s) ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}` : s;
    }
    default:
      return typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : String(v);
  }
}

export function textoCelula(c: Celula | undefined, f?: Formato): string {
  if (c === null || c === undefined) return '—';
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return formatar(c, f);
  if (c.o === 'ausente') return 'ausente';
  return formatar(c.v, c.f ?? f);
}

export const moeda = (v: unknown) =>
  typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';

export function competencia(c?: string | null) {
  if (!c) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(c);
  return m ? `${m[2]}/${m[1]}` : c;
}

export function dataHora(s?: string | null) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pt-BR');
}

export function data(s?: string | null) {
  return formatar(s ?? null, 'data');
}

export function cpf(s?: string | null) {
  return formatar(s ?? null, 'cpf');
}

export function documentoEmpresa(chave?: string | null, completo?: string | null) {
  if (completo) return completo.length === 14 ? formatar(completo, 'cnpj') : formatar(completo, 'cpf');
  if (!chave) return '';
  const [tp, nr] = chave.split(':');
  return tp === '1' ? `CNPJ raiz ${nr.slice(0, 2)}.${nr.slice(2, 5)}.${nr.slice(5, 8)}` : `CPF ${formatar(nr, 'cpf')}`;
}

export function bytes(n?: number | null) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${u[i]}`;
}

export const ROTULO_ORIGEM: Record<string, string> = { xml: 'XML', calculado: 'CALC', complementado: 'COMP', ausente: 'AUSENTE' };
export const NOME_ORIGEM: Record<string, string> = {
  xml: 'Veio do XML importado',
  calculado: 'Calculado pelo sistema',
  complementado: 'Complementado pelo usuário',
  ausente: 'Ausente nos dados disponíveis',
};

export const SITUACAO_EVENTO: Record<string, { rotulo: string; classe: string }> = {
  ativo: { rotulo: 'Ativo', classe: 'ok' },
  retificado: { rotulo: 'Retificado', classe: 'neutra' },
  excluido: { rotulo: 'Excluído (S-3000)', classe: 'neutra' },
  substituido: { rotulo: 'Substituído', classe: 'neutra' },
  substituido_inferido: { rotulo: 'Possível duplicidade', classe: 'alerta' },
  producao_restrita: { rotulo: 'Produção restrita', classe: 'alerta' },
};

export const STATUS_XSD: Record<string, { rotulo: string; classe: string }> = {
  nao_validado: { rotulo: 'XSD pendente', classe: 'neutra' },
  valido: { rotulo: 'XSD válido', classe: 'ok' },
  invalido: { rotulo: 'XSD inválido', classe: 'erro' },
  sem_xsd: { rotulo: 'Sem XSD', classe: 'neutra' },
  erro_validacao: { rotulo: 'Falha na validação', classe: 'alerta' },
};
