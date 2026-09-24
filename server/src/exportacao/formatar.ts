import type { Celula, Formato, Val } from '../compartilhado/tipos.js';

export const ehVal = (c: Celula): c is Val => !!c && typeof c === 'object' && 'o' in c;

export function formatarValor(v: string | number | null, f?: Formato): string {
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
      const s = String(v);
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
    }
    case 'competencia': {
      const s = String(v);
      const m = /^(\d{4})-(\d{2})$/.exec(s);
      return m ? `${m[2]}/${m[1]}` : s;
    }
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

/** Texto para exibição. Ausente nunca vira zero; "—" indica não aplicável. */
export function textoCelula(c: Celula, tipoColuna?: Formato): string {
  if (c === null || c === undefined) return '—';
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return formatarValor(c, tipoColuna);
  if (c.o === 'ausente') return 'ausente';
  return formatarValor(c.v, c.f ?? tipoColuna);
}

export function numeroCelula(c: Celula): number | null {
  if (typeof c === 'number') return c;
  if (ehVal(c) && typeof c.v === 'number' && c.o !== 'ausente') return c.v;
  return null;
}

export const ROTULO_ORIGEM: Record<string, string> = {
  xml: 'XML',
  calculado: 'Calculado',
  complementado: 'Complementado',
  ausente: 'Ausente',
};

export function descreverOrigem(v: Val): string {
  if (v.o === 'xml' && v.x) {
    return [`${v.x.tipoEvento} ${v.x.eventoId}`, v.x.recibo ? `recibo ${v.x.recibo}` : 'sem recibo', `campo ${v.x.campo}`, v.x.arquivo ? `arquivo ${v.x.arquivo}` : '']
      .filter(Boolean)
      .join(' · ');
  }
  if (v.c) {
    const t = v.c.tabela ? ` · tabela ${v.c.tabela.id} v${v.c.tabela.versao} (${v.c.tabela.fonte})` : '';
    const inc = v.c.incompleto?.length ? ` · incompleto: ${v.c.incompleto.join('; ')}` : '';
    return `${v.c.regra} v${v.c.versao}: ${v.c.formula}${t}${inc}`;
  }
  if (v.o === 'complementado' && v.m) return `Complemento: ${v.m.origem}${v.m.informadoEm ? ` (${v.m.informadoEm.slice(0, 10)})` : ''}`;
  if (v.o === 'ausente') return v.obs ?? 'Não encontrado nos dados disponíveis';
  return v.obs ?? '';
}

export function nomeArquivo(tipo: string, empresa: string, competencia: string | undefined, ext: string) {
  const emp = empresa.replace(/[^0-9A-Za-z]/g, '');
  const comp = (competencia ?? '').replace(/[^0-9]/g, '');
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${tipo}_${emp}${comp ? '_' + comp : ''}_${ts}.${ext}`;
}
