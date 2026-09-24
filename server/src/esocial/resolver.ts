/**
 * Determina a situação de cada evento (ativo, retificado, excluído,
 * substituído) sem alterar o conteúdo original. É recalculado a cada
 * importação e pode ser refeito a qualquer momento (é determinístico).
 *
 * Regras (versão RESOLUCAO_V1):
 * 1. Retificação: evento com indRetif=2 aponta (nrRecibo) para o recibo do
 *    evento retificado. Eventos ligados por recibos formam uma "família";
 *    somente o mais recente da família permanece ativo.
 * 2. Exclusão: S-3000 aponta (nrRecEvt) para o recibo do evento excluído.
 * 3. Totalizadores cujo evento de origem (nrRecArqBase) não está ativo são
 *    marcados como substituídos.
 * 4. Sem vínculo por recibo, eventos com a mesma chave natural (mesmo
 *    trabalhador/período/tipo) não podem estar ativos ao mesmo tempo no
 *    eSocial; o mais recente é mantido e os demais ficam como
 *    "substituido_inferido" (sinalizado como pendência).
 * 5. Eventos do ambiente de produção restrita (tpAmb=2) ficam fora dos
 *    relatórios.
 */
import type { DB } from '../db/armazenamento.js';
import { carimboDoId } from './extrair.js';

export const VERSAO_RESOLUCAO = 'RESOLUCAO_V1';

interface Linha {
  id: number;
  evento_id: string;
  tipo: string;
  chave_natural: string | null;
  ind_retif: string | null;
  nr_recibo_retificado: string | null;
  nr_rec_arq_base: string | null;
  tp_amb: string | null;
  nr_recibo: string | null;
  dh_processamento: string | null;
  situacao: string;
  situacao_motivo: string | null;
  substituido_por: number | null;
}

const TABELAS = new Set(['S-1000', 'S-1005', 'S-1010', 'S-1020', 'S-1070']);
const TOTALIZADORES = new Set(['S-5001', 'S-5002', 'S-5003', 'S-5011', 'S-5012', 'S-5013']);

function ordem(l: Linha): string {
  const dh = l.dh_processamento ? l.dh_processamento.replace(/\D/g, '').padEnd(19, '0').slice(0, 19) : '';
  const carimbo = carimboDoId(l.evento_id);
  return `${dh || carimbo || '0'.repeat(19)}|${carimbo}|${String(l.id).padStart(12, '0')}`;
}

export function resolverSituacoes(db: DB, empChaves?: string[]) {
  const filtro = empChaves?.length ? `WHERE e.emp_chave IN (${empChaves.map(() => '?').join(',')})` : '';
  const linhas = db
    .prepare(
      `SELECT e.id, e.evento_id, e.tipo, e.chave_natural, e.ind_retif, e.nr_recibo_retificado,
              e.nr_rec_arq_base, e.tp_amb, r.nr_recibo, r.dh_processamento,
              'ativo' AS situacao, NULL AS situacao_motivo, NULL AS substituido_por
         FROM eventos e LEFT JOIN recibos r ON r.evento_id = e.evento_id ${filtro}`,
    )
    .all(...(empChaves ?? [])) as Linha[];

  const porRecibo = new Map<string, Linha>();
  for (const l of linhas) if (l.nr_recibo) porRecibo.set(l.nr_recibo, l);

  const marcar = (l: Linha, situacao: string, motivo: string, por?: number) => {
    l.situacao = situacao;
    l.situacao_motivo = motivo;
    l.substituido_por = por ?? null;
  };

  // 0) ambiente de produção restrita
  for (const l of linhas) {
    if (l.tp_amb === '2') marcar(l, 'producao_restrita', 'Evento do ambiente de produção restrita (testes).');
  }

  // 1) famílias de retificação (union-find por recibo)
  const paiUF = new Map<number, number>();
  const achar = (x: number): number => {
    let r = x;
    while (paiUF.has(r) && paiUF.get(r) !== r) r = paiUF.get(r)!;
    paiUF.set(x, r);
    return r;
  };
  const unir = (a: number, b: number) => {
    const ra = achar(a);
    const rb = achar(b);
    if (ra !== rb) paiUF.set(ra, rb);
  };
  for (const l of linhas) {
    if (l.tipo === 'S-3000' || l.ind_retif !== '2' || !l.nr_recibo_retificado) continue;
    const alvo = porRecibo.get(l.nr_recibo_retificado);
    if (alvo) unir(l.id, alvo.id);
    else
      l.situacao_motivo =
        'Retificação de evento cujo recibo original não foi importado (o original não está nos arquivos).';
  }
  const familias = new Map<number, Linha[]>();
  for (const l of linhas) {
    if (!paiUF.has(l.id)) continue;
    const r = achar(l.id);
    if (!familias.has(r)) familias.set(r, []);
    familias.get(r)!.push(l);
  }
  for (const membros of familias.values()) {
    const candidatos = membros.filter((m) => m.situacao === 'ativo').sort((a, b) => ordem(a).localeCompare(ordem(b)));
    const vigente = candidatos[candidatos.length - 1];
    for (const m of candidatos) {
      if (m !== vigente) {
        marcar(m, 'retificado', `Substituído por retificação (evento ${vigente.evento_id}).`, vigente.id);
      }
    }
  }

  // 2) exclusões (S-3000)
  for (const l of linhas) {
    if (l.tipo !== 'S-3000' || l.situacao !== 'ativo' || !l.nr_recibo_retificado) continue;
    const alvo = porRecibo.get(l.nr_recibo_retificado);
    if (alvo) marcar(alvo, 'excluido', `Excluído pelo S-3000 (evento ${l.evento_id}).`, l.id);
    else l.situacao_motivo = 'Exclusão de evento cujo recibo não foi importado.';
  }

  // 3) chave natural sem vínculo por recibo
  const grupos = new Map<string, Linha[]>();
  for (const l of linhas) {
    if (l.situacao !== 'ativo' || !l.chave_natural || TABELAS.has(l.tipo) || l.tipo === 'S-3000') continue;
    if (!grupos.has(l.chave_natural)) grupos.set(l.chave_natural, []);
    grupos.get(l.chave_natural)!.push(l);
  }
  for (const membros of grupos.values()) {
    if (membros.length < 2) continue;
    membros.sort((a, b) => ordem(a).localeCompare(ordem(b)));
    const vigente = membros[membros.length - 1];
    for (const m of membros.slice(0, -1)) {
      marcar(
        m,
        'substituido_inferido',
        `Há evento mais recente para o mesmo trabalhador/período (${vigente.evento_id}); ` +
          'a retificação/exclusão correspondente não consta nos arquivos importados.',
        vigente.id,
      );
    }
  }

  // 4) totalizadores de eventos de origem não ativos
  for (const l of linhas) {
    if (!TOTALIZADORES.has(l.tipo) || l.situacao !== 'ativo' || !l.nr_rec_arq_base) continue;
    const base = porRecibo.get(l.nr_rec_arq_base);
    if (base && base.situacao !== 'ativo') {
      marcar(l, 'substituido', `Evento de origem (${base.evento_id}) não está ativo (${base.situacao}).`, base.id);
    }
  }

  const upd = db.prepare(
    'UPDATE eventos SET situacao = ?, situacao_motivo = ?, substituido_por = ? WHERE id = ?',
  );
  db.transaction(() => {
    for (const l of linhas) upd.run(l.situacao, l.situacao_motivo, l.substituido_por, l.id);
  })();

  const resumo: Record<string, number> = {};
  for (const l of linhas) resumo[l.situacao] = (resumo[l.situacao] ?? 0) + 1;
  return resumo;
}
