/**
 * Importação de XMLs/ZIPs do eSocial.
 *
 * - O arquivo original é preservado (cifrado) sem alteração.
 * - Cada XML interno é registrado (nome, hash, tamanho, resultado).
 * - Eventos são deduplicados pelo Id; o histórico de importações e de
 *   ocorrências é mantido.
 * - Ao final, a situação dos eventos (retificação/exclusão) é recalculada.
 */
import { createHash } from 'node:crypto';
import type { Config } from '../config.js';
import type { Armazenamento } from '../db/armazenamento.js';
import { extrairDoDocumento, type EventoExtraido, type ReciboExtraido } from '../esocial/extrair.js';
import { resolverSituacoes } from '../esocial/resolver.js';
import { log } from '../util/log.js';
import { lerXml } from '../xml/arvore.js';
import { ehZip, lerZip, ZipRejeitadoError } from '../xml/zip.js';

export interface ArquivoParaImportar {
  nomeArquivo: string;
  dados: Buffer;
  origem: 'upload' | 'pasta_monitorada' | 'demonstracao';
  solicitacaoId?: number | null;
}

export interface ResumoImportacao {
  importacaoId: number;
  nomeArquivo: string;
  tipo: 'zip' | 'xml';
  status: 'concluida' | 'concluida_com_erros' | 'rejeitada';
  mensagem?: string;
  arquivoRepetidoDe?: number | null;
  arquivos: { total: number; lidos: number; comErro: number; ignorados: number; semEventos: number };
  eventos: { encontrados: number; novos: number; repetidos: number; conflitos: number; semRecibo: number };
  recibos: number;
  porTipo: Record<string, number>;
  empregadores: string[];
  periodo: { inicio?: string; fim?: string };
  trabalhadores: number;
  producaoRestrita: number;
  totalizadores: number;
  erros: Array<{ arquivo: string; mensagem: string }>;
  avisos: string[];
  situacoes?: Record<string, number>;
}

const agora = () => new Date().toISOString();
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

export async function importarArquivo(
  arm: Armazenamento,
  cfg: Pick<Config, 'limitesXml' | 'limitesZip'>,
  arq: ArquivoParaImportar,
): Promise<ResumoImportacao> {
  const db = arm.db;
  const hash = sha256(arq.dados);
  const zip = ehZip(arq.dados);
  const anterior = db
    .prepare('SELECT id FROM importacoes WHERE sha256 = ? ORDER BY id LIMIT 1')
    .get(hash) as { id: number } | undefined;

  await arm.salvarOriginal(hash, arq.dados);

  const nomeSeguro = arq.nomeArquivo.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 255) || 'arquivo';
  const importacaoId = Number(
    db
      .prepare(
        `INSERT INTO importacoes (nome_arquivo, tamanho, sha256, tipo, origem, solicitacao_id, importado_em, status, arquivo_repetido_de)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'processando', ?)`,
      )
      .run(nomeSeguro, arq.dados.length, hash, zip ? 'zip' : 'xml', arq.origem, arq.solicitacaoId ?? null, agora(), anterior?.id ?? null)
      .lastInsertRowid,
  );

  const resumo: ResumoImportacao = {
    importacaoId,
    nomeArquivo: nomeSeguro,
    tipo: zip ? 'zip' : 'xml',
    status: 'concluida',
    arquivoRepetidoDe: anterior?.id ?? null,
    arquivos: { total: 0, lidos: 0, comErro: 0, ignorados: 0, semEventos: 0 },
    eventos: { encontrados: 0, novos: 0, repetidos: 0, conflitos: 0, semRecibo: 0 },
    recibos: 0,
    porTipo: {},
    empregadores: [],
    periodo: {},
    trabalhadores: 0,
    producaoRestrita: 0,
    totalizadores: 0,
    erros: [],
    avisos: [],
  };
  if (anterior) {
    resumo.avisos.push(
      `Arquivo idêntico já importado (importação nº ${anterior.id}). Os eventos repetidos não são duplicados.`,
    );
  }

  const empregadores = new Set<string>();
  const cpfs = new Set<string>();
  const periodos: string[] = [];

  const insArquivo = db.prepare(
    `INSERT INTO arquivos_xml (importacao_id, caminho, sha256, tamanho, status, mensagem, qtd_eventos)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const selEvento = db.prepare('SELECT id, hash_conteudo FROM eventos WHERE evento_id = ?');
  const insEvento = db.prepare(
    `INSERT INTO eventos (evento_id, tipo, tag, namespace, versao_leiaute, emp_tp, emp_nr, emp_chave, cpf, matricula,
       per_apur, ind_apuracao, data_ref, ind_retif, nr_recibo_retificado, tp_amb, chave_natural, operacao,
       nr_rec_arq_base, origem, hash_conteudo, arvore_json, xml, primeira_importacao_id, criado_em)
     VALUES (@eventoId, @tipo, @tag, @namespace, @versaoLeiaute, @empTp, @empNr, @empChave, @cpf, @matricula,
       @perApur, @indApuracao, @dataRef, @indRetif, @nrReciboRetificado, @tpAmb, @chaveNatural, @operacao,
       @nrRecArqBase, @origem, @hash, @arvoreJson, @xml, @importacaoId, @criadoEm)`,
  );
  const insOcorrencia = db.prepare(
    'INSERT OR IGNORE INTO ocorrencias (evento_pk, arquivo_xml_id, importacao_id) VALUES (?, ?, ?)',
  );
  const insConflito = db.prepare(
    `INSERT INTO conflitos (evento_id, importacao_id, arquivo_xml_id, hash_conteudo, detectado_em, descricao)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const selRecibo = db.prepare('SELECT nr_recibo FROM recibos WHERE evento_id = ?');
  const insRecibo = db.prepare(
    `INSERT INTO recibos (evento_id, nr_recibo, cd_resposta, desc_resposta, dh_processamento, dh_recepcao, protocolo, importacao_id)
     VALUES (@eventoId, @nrRecibo, @cdResposta, @descResposta, @dhProcessamento, @dhRecepcao, @protocolo, @importacaoId)`,
  );

  const gravar = db.transaction(
    (caminho: string, bytes: Buffer, eventos: EventoExtraido[], recibos: ReciboExtraido[], avisos: string[]) => {
      const status = eventos.length || recibos.length ? 'ok' : 'sem_eventos';
      const arquivoId = Number(
        insArquivo.run(
          importacaoId,
          caminho,
          sha256(bytes),
          bytes.length,
          status,
          status === 'sem_eventos' ? 'Nenhum evento do eSocial encontrado neste XML.' : avisos.join(' ') || null,
          eventos.length,
        ).lastInsertRowid,
      );
      if (status === 'sem_eventos') resumo.arquivos.semEventos++;
      for (const ev of eventos) {
        resumo.eventos.encontrados++;
        resumo.porTipo[ev.tipo] = (resumo.porTipo[ev.tipo] ?? 0) + 1;
        if (ev.empChave) empregadores.add(ev.empChave);
        if (ev.cpf) cpfs.add(ev.cpf);
        if (ev.perApur && /^\d{4}-\d{2}$/.test(ev.perApur) && !ev.tipo.startsWith('S-10')) periodos.push(ev.perApur);
        if (ev.tpAmb === '2') resumo.producaoRestrita++;
        if (ev.tipo.startsWith('S-50')) resumo.totalizadores++;
        const existente = selEvento.get(ev.eventoId) as { id: number; hash_conteudo: string } | undefined;
        let pk: number;
        if (!existente) {
          pk = Number(
            insEvento.run({
              eventoId: ev.eventoId,
              tipo: ev.tipo,
              tag: ev.tag,
              origem: ev.origem,
              hash: ev.hash,
              xml: ev.xml,
              namespace: ev.namespace ?? null,
              versaoLeiaute: ev.versaoLeiaute ?? null,
              empTp: ev.empTp ?? null,
              empNr: ev.empNr ?? null,
              empChave: ev.empChave ?? null,
              cpf: ev.cpf ?? null,
              matricula: ev.matricula ?? null,
              perApur: ev.perApur ?? null,
              indApuracao: ev.indApuracao ?? null,
              dataRef: ev.dataRef ?? null,
              indRetif: ev.indRetif ?? null,
              nrReciboRetificado: ev.nrReciboRetificado ?? null,
              tpAmb: ev.tpAmb ?? null,
              chaveNatural: ev.chaveNatural ?? null,
              operacao: ev.operacao ?? null,
              nrRecArqBase: ev.nrRecArqBase ?? null,
              arvoreJson: JSON.stringify(ev.arvore),
              importacaoId,
              criadoEm: agora(),
            }).lastInsertRowid,
          );
          resumo.eventos.novos++;
        } else {
          pk = existente.id;
          if (existente.hash_conteudo === ev.hash) {
            resumo.eventos.repetidos++;
          } else {
            resumo.eventos.conflitos++;
            insConflito.run(
              ev.eventoId,
              importacaoId,
              arquivoId,
              ev.hash,
              agora(),
              'Evento com o mesmo Id e conteúdo diferente do já importado. O conteúdo original foi mantido.',
            );
          }
        }
        insOcorrencia.run(pk, arquivoId, importacaoId);
      }
      for (const r of recibos) {
        const atual = selRecibo.get(r.eventoId) as { nr_recibo: string } | undefined;
        if (!atual) {
          insRecibo.run({
            eventoId: r.eventoId,
            nrRecibo: r.nrRecibo,
            cdResposta: r.cdResposta ?? null,
            descResposta: r.descResposta ?? null,
            dhProcessamento: r.dhProcessamento ?? null,
            dhRecepcao: r.dhRecepcao ?? null,
            protocolo: r.protocolo ?? null,
            importacaoId,
          });
          resumo.recibos++;
        } else if (atual.nr_recibo !== r.nrRecibo) {
          insConflito.run(
            r.eventoId,
            importacaoId,
            arquivoId,
            null,
            agora(),
            `Recibo divergente para o mesmo evento; mantido o primeiro recibo importado.`,
          );
        }
      }
    },
  );

  const registrarErro = (caminho: string, mensagem: string, bytes?: Buffer, ignorado = false) => {
    insArquivo.run(importacaoId, caminho, bytes ? sha256(bytes) : null, bytes?.length ?? null, ignorado ? 'ignorado' : 'erro', mensagem, 0);
    if (ignorado) resumo.arquivos.ignorados++;
    else {
      resumo.arquivos.comErro++;
      if (resumo.erros.length < 200) resumo.erros.push({ arquivo: caminho, mensagem });
    }
  };

  const processarXml = (caminho: string, bytes: Buffer) => {
    resumo.arquivos.total++;
    try {
      const raiz = lerXml(bytes, cfg.limitesXml);
      const { eventos, recibos, avisos } = extrairDoDocumento(raiz);
      gravar(caminho, bytes, eventos, recibos, avisos);
      resumo.arquivos.lidos++;
      for (const a of avisos) if (resumo.avisos.length < 50) resumo.avisos.push(`${caminho}: ${a}`);
    } catch (e) {
      registrarErro(caminho, (e as Error).message, bytes);
    }
  };

  try {
    if (zip) {
      for await (const item of lerZip(arq.dados, cfg.limitesZip)) {
        if (item.erro !== undefined) {
          resumo.arquivos.total++;
          registrarErro(item.nome, item.erro, undefined, item.erro.startsWith('Ignorado'));
        } else {
          processarXml(item.nome, item.dados);
        }
      }
    } else {
      processarXml(nomeSeguro, arq.dados);
    }
  } catch (e) {
    const msg = e instanceof ZipRejeitadoError ? e.message : `Falha na importação: ${(e as Error).message}`;
    resumo.status = 'rejeitada';
    resumo.mensagem = msg;
  }

  // eventos importados sem recibo conhecido
  const semRecibo = db
    .prepare(
      `SELECT count(*) AS n FROM ocorrencias o JOIN eventos e ON e.id = o.evento_pk
        LEFT JOIN recibos r ON r.evento_id = e.evento_id
        WHERE o.importacao_id = ? AND r.evento_id IS NULL AND e.tipo NOT LIKE 'S-50%'`,
    )
    .get(importacaoId) as { n: number };
  resumo.eventos.semRecibo = semRecibo.n;

  resumo.empregadores = [...empregadores].sort();
  resumo.trabalhadores = cpfs.size;
  periodos.sort();
  resumo.periodo = { inicio: periodos[0], fim: periodos[periodos.length - 1] };
  if (resumo.status !== 'rejeitada' && resumo.arquivos.comErro > 0) resumo.status = 'concluida_com_erros';
  if (resumo.status !== 'rejeitada' && resumo.arquivos.total === 0) {
    resumo.status = 'rejeitada';
    resumo.mensagem = 'Nenhum arquivo XML encontrado.';
  }

  if (resumo.empregadores.length) {
    resumo.situacoes = resolverSituacoes(db, resumo.empregadores);
    registrarEmpresasDetectadas(arm, resumo.empregadores);
  }

  db.prepare(
    `UPDATE importacoes SET status = ?, mensagem = ?, qtd_arquivos = ?, qtd_arquivos_erro = ?, qtd_eventos = ?,
       qtd_eventos_novos = ?, qtd_eventos_repetidos = ?, qtd_recibos = ?, empregadores = ?, periodo_inicio = ?,
       periodo_fim = ?, resumo_json = ? WHERE id = ?`,
  ).run(
    resumo.status,
    resumo.mensagem ?? null,
    resumo.arquivos.total,
    resumo.arquivos.comErro,
    resumo.eventos.encontrados,
    resumo.eventos.novos,
    resumo.eventos.repetidos,
    resumo.recibos,
    JSON.stringify(resumo.empregadores),
    resumo.periodo.inicio ?? null,
    resumo.periodo.fim ?? null,
    JSON.stringify(resumo),
    importacaoId,
  );
  if (arq.solicitacaoId) {
    db.prepare(`UPDATE solicitacoes SET status = 'importado', atualizado_em = ? WHERE id = ?`).run(agora(), arq.solicitacaoId);
  }
  arm.auditar('importacao', `importacao=${importacaoId} eventos=${resumo.eventos.encontrados} novos=${resumo.eventos.novos}`);
  log.info('Importação concluída', {
    importacao: importacaoId,
    arquivos: resumo.arquivos.total,
    eventos: resumo.eventos.encontrados,
    novos: resumo.eventos.novos,
    status: resumo.status,
  });
  return resumo;
}

export function registrarEmpresasDetectadas(arm: Armazenamento, chaves: string[]) {
  const ins = arm.db.prepare(
    `INSERT OR IGNORE INTO empresas (tp_insc, nr_insc, chave, origem_cadastro, cadastrado_em, atualizado_em)
     VALUES (?, ?, ?, 'detectada_nos_xmls', ?, ?)`,
  );
  for (const c of chaves) {
    const [tp, nr] = c.split(':');
    ins.run(tp, nr, c, agora(), agora());
  }
}

/** Remove uma importação; eventos que não aparecem em nenhuma outra importação são removidos. */
export async function excluirImportacao(arm: Armazenamento, id: number) {
  const db = arm.db;
  const imp = db.prepare('SELECT id, sha256, empregadores FROM importacoes WHERE id = ?').get(id) as
    | { id: number; sha256: string; empregadores: string | null }
    | undefined;
  if (!imp) return false;
  db.transaction(() => {
    db.prepare('DELETE FROM ocorrencias WHERE importacao_id = ?').run(id);
    db.prepare('DELETE FROM eventos WHERE id NOT IN (SELECT evento_pk FROM ocorrencias)').run();
    db.prepare(
      'DELETE FROM recibos WHERE importacao_id = ? AND evento_id NOT IN (SELECT evento_id FROM eventos)',
    ).run(id);
    db.prepare('DELETE FROM arquivos_xml WHERE importacao_id = ?').run(id);
    db.prepare('DELETE FROM conflitos WHERE importacao_id = ?').run(id);
    db.prepare('DELETE FROM importacoes WHERE id = ?').run(id);
  })();
  const outros = db.prepare('SELECT count(*) AS n FROM importacoes WHERE sha256 = ?').get(imp.sha256) as { n: number };
  if (!outros.n) await arm.removerOriginal(imp.sha256);
  const emps = imp.empregadores ? (JSON.parse(imp.empregadores) as string[]) : [];
  if (emps.length) resolverSituacoes(db, emps);
  arm.auditar('exclusao_importacao', `importacao=${id}`);
  return true;
}
