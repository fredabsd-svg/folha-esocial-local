import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { Campo, Carregando, Erro, Etiqueta, Tabs, Vazio } from '../componentes';
import { useApp, useCarregar } from '../contexto';
import { competencia as fmtComp, cpf as fmtCpf, data, dataHora, SITUACAO_EVENTO, STATUS_XSD } from '../formato';

interface XNode { n: string; a?: Record<string, string>; c?: XNode[]; t?: string }
interface Item {
  id: number;
  evento_id: string;
  tipo: string;
  nome_evento: string;
  emp_chave: string;
  cpf: string | null;
  matricula: string | null;
  per_apur: string | null;
  ind_apuracao: string | null;
  data_ref: string | null;
  ind_retif: string | null;
  situacao: string;
  situacao_motivo: string | null;
  versao_leiaute: string | null;
  xsd_status: string;
  origem: string;
  nr_recibo: string | null;
}

function lerSessao(chave: string) {
  try {
    const v = sessionStorage.getItem(chave) ?? '';
    sessionStorage.removeItem(chave);
    return v;
  } catch {
    return '';
  }
}

export function Eventos({ id }: { id?: string }) {
  if (id) return <DetalheEvento id={Number(id)} />;
  return <ListaEventos />;
}

function ListaEventos() {
  const { empresa, versaoDados } = useApp();
  const catalogo = useCarregar(() => api.get<{ eventos: Record<string, { codigo: string; nome: string }> }>('/api/catalogo'), []);
  const [filtros, setFiltros] = useState(() => ({
    tipo: lerSessao('folha.filtroTipo'),
    situacao: '',
    q: '',
    rubrica: '',
    perIni: '',
    perFim: '',
    importacao: lerSessao('folha.filtroImportacao'),
    todas: false,
  }));
  const [aplicados, setAplicados] = useState(filtros);
  const [pagina, setPagina] = useState(1);
  const r = useCarregar(
    () =>
      api.get<{ total: number; pagina: number; itens: Item[] }>(
        `/api/eventos${qs({ ...aplicados, todas: undefined, empresa: aplicados.todas || aplicados.importacao ? undefined : empresa, pagina })}`,
      ),
    [aplicados, pagina, empresa, versaoDados],
  );
  const set = (k: string, v: string | boolean) => setFiltros((f) => ({ ...f, [k]: v }));
  const tipos = Object.values(catalogo.dados?.eventos ?? {}).sort((a, b) => a.codigo.localeCompare(b.codigo));

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Eventos</h1>
          <p>Pesquise por tipo, trabalhador (nome, CPF ou matrícula), rubrica, período e situação. Eventos retificados, excluídos e substituídos continuam disponíveis no histórico.</p>
        </div>
      </div>
      <form
        className="cartao"
        onSubmit={(e) => {
          e.preventDefault();
          setPagina(1);
          setAplicados(filtros);
        }}
      >
        <div className="grade grade-4">
          <Campo rotulo="Tipo de evento" id="f-tipo">
            <select id="f-tipo" value={filtros.tipo} onChange={(e) => set('tipo', e.target.value)}>
              <option value="">Todos</option>
              {tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.codigo} — {t.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Trabalhador, CPF, matrícula ou Id" id="f-q"><input id="f-q" type="search" value={filtros.q} onChange={(e) => set('q', e.target.value)} /></Campo>
          <Campo rotulo="Código da rubrica" id="f-rub"><input id="f-rub" type="text" value={filtros.rubrica} onChange={(e) => set('rubrica', e.target.value)} /></Campo>
          <Campo rotulo="Situação" id="f-sit">
            <select id="f-sit" value={filtros.situacao} onChange={(e) => set('situacao', e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(SITUACAO_EVENTO).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Competência inicial" id="f-ini"><input id="f-ini" type="month" value={filtros.perIni} onChange={(e) => set('perIni', e.target.value)} /></Campo>
          <Campo rotulo="Competência final" id="f-fim"><input id="f-fim" type="month" value={filtros.perFim} onChange={(e) => set('perFim', e.target.value)} /></Campo>
          <Campo rotulo="Importação nº" id="f-imp"><input id="f-imp" type="number" min={1} value={filtros.importacao} onChange={(e) => set('importacao', e.target.value)} /></Campo>
          <div className="campo" style={{ justifyContent: 'flex-end' }}>
            <label className="checkbox"><input type="checkbox" checked={filtros.todas} onChange={(e) => set('todas', e.target.checked)} /><span>Todas as empresas</span></label>
          </div>
        </div>
        <div className="linha fim" style={{ marginTop: 12 }}>
          <button type="button" className="botao" onClick={() => { const v = { tipo: '', situacao: '', q: '', rubrica: '', perIni: '', perFim: '', importacao: '', todas: false }; setFiltros(v); setAplicados(v); }}>Limpar</button>
          <button type="submit" className="botao primario">Pesquisar</button>
        </div>
      </form>
      <section className="cartao">
        {r.carregando && !r.dados ? <Carregando /> : r.erro ? <Erro texto={r.erro} /> : !r.dados?.itens.length ? (
          <Vazio titulo="Nenhum evento encontrado"><p>Ajuste os filtros ou importe XMLs.</p></Vazio>
        ) : (
          <>
            <div className="cartao-titulo"><h2>{r.dados.total.toLocaleString('pt-BR')} evento(s)</h2><span className="legenda">Página {r.dados.pagina} de {Math.max(1, Math.ceil(r.dados.total / 100))}</span></div>
            <div className="tabela-rolagem">
              <table className="dados">
                <thead><tr><th>Tipo</th><th>CPF</th><th>Matrícula</th><th>Período / data</th><th>Retificação</th><th>Situação</th><th>XSD</th><th>Recibo</th></tr></thead>
                <tbody>
                  {r.dados.itens.map((i) => (
                    <tr key={i.id} className="clicavel" tabIndex={0} onClick={() => (window.location.hash = `#/eventos/${i.id}`)} onKeyDown={(e) => e.key === 'Enter' && (window.location.hash = `#/eventos/${i.id}`)}>
                      <td><strong>{i.tipo}</strong><div className="legenda">{i.nome_evento}</div></td>
                      <td className="num">{fmtCpf(i.cpf) || '—'}</td>
                      <td>{i.matricula ?? '—'}</td>
                      <td>{i.per_apur ? fmtComp(i.per_apur) : data(i.data_ref) || '—'}{i.ind_apuracao === '2' ? ' (13º)' : ''}</td>
                      <td>{i.ind_retif === '2' ? 'Retificador' : i.ind_retif === '1' ? 'Original' : '—'}</td>
                      <td><Etiqueta classe={SITUACAO_EVENTO[i.situacao]?.classe ?? 'neutra'}>{SITUACAO_EVENTO[i.situacao]?.rotulo ?? i.situacao}</Etiqueta></td>
                      <td><Etiqueta classe={STATUS_XSD[i.xsd_status]?.classe ?? 'neutra'}>{STATUS_XSD[i.xsd_status]?.rotulo ?? i.xsd_status}</Etiqueta></td>
                      <td className="mono pequeno">{i.nr_recibo ?? (i.origem === 'totalizador_no_recibo' ? 'totalizador' : '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="linha fim" style={{ marginTop: 12 }}>
              <button className="botao pequeno" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
              <button className="botao pequeno" disabled={pagina * 100 >= r.dados.total} onClick={() => setPagina(pagina + 1)}>Próxima</button>
            </div>
          </>
        )}
      </section>
    </>
  );
}

interface Detalhe extends Item {
  tag: string;
  namespace: string | null;
  emp_tp: string | null;
  emp_nr: string | null;
  xml: string;
  xsd_mensagem: string | null;
  nr_recibo_retificado: string | null;
  nr_rec_arq_base: string | null;
  chave_natural: string | null;
  hash_conteudo: string;
  criado_em: string;
  arvore: XNode;
  recibo: { nr_recibo: string; cd_resposta: string | null; desc_resposta: string | null; dh_processamento: string | null; dh_recepcao: string | null; protocolo: string | null } | null;
  ocorrencias: Array<{ importacao_id: number; nome_arquivo: string; importado_em: string; caminho: string }>;
  relacionados: Array<{ id: number; evento_id: string; tipo: string; situacao: string; situacao_motivo: string | null }>;
  conflitos: Array<{ id: number; descricao: string; detectado_em: string }>;
}

function No({ no, nivel = 0 }: { no: XNode; nivel?: number }) {
  const attrs = no.a ? Object.entries(no.a).map(([k, v]) => ` ${k}="${v}"`).join('') : '';
  if (!no.c?.length) {
    return <div className="folha"><b>{no.n}</b>{attrs}: {no.t ?? ''}</div>;
  }
  return (
    <details open={nivel < 3}>
      <summary><b style={{ color: 'var(--cor-primaria)' }}>{no.n}</b>{attrs}</summary>
      {no.c.map((f, i) => <No key={i} no={f} nivel={nivel + 1} />)}
    </details>
  );
}

function DetalheEvento({ id }: { id: number }) {
  const d = useCarregar(() => api.get<Detalhe>(`/api/eventos/${id}`), [id]);
  const [aba, setAba] = useState<'campos' | 'xml'>('campos');
  useEffect(() => setAba('campos'), [id]);
  if (d.carregando && !d.dados) return <Carregando />;
  if (d.erro) return <Erro texto={d.erro} />;
  const e = d.dados!;
  const sit = SITUACAO_EVENTO[e.situacao];
  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <a href="#/eventos">← Eventos</a>
          <h1 style={{ marginTop: 8 }}>{e.tipo} — {e.nome_evento}</h1>
          <p className="mono">{e.evento_id}</p>
        </div>
        <div className="linha">
          <Etiqueta classe={sit?.classe ?? 'neutra'}>{sit?.rotulo ?? e.situacao}</Etiqueta>
          <Etiqueta classe={STATUS_XSD[e.xsd_status]?.classe ?? 'neutra'}>{STATUS_XSD[e.xsd_status]?.rotulo ?? e.xsd_status}</Etiqueta>
        </div>
      </div>
      {e.situacao_motivo && <div className={`aviso ${e.situacao === 'ativo' ? 'info' : 'alerta'}`}><div>{e.situacao_motivo}</div></div>}
      {!!e.conflitos.length && <div className="aviso erro"><div><strong>Conflito</strong>{e.conflitos.map((c) => c.descricao).join(' ')}</div></div>}
      <div className="grade grade-2">
        <section className="cartao">
          <h2>Identificação</h2>
          <dl className="detalhes" style={{ marginTop: 12 }}>
            <dt>Leiaute</dt><dd>{e.versao_leiaute ?? '—'} <span className="legenda mono">{e.namespace}</span></dd>
            <dt>Empregador</dt><dd>{e.emp_tp === '1' ? 'CNPJ' : 'CPF'} {e.emp_nr}</dd>
            <dt>Trabalhador</dt><dd>{fmtCpf(e.cpf) || '—'} {e.matricula ? `· matrícula ${e.matricula}` : ''}</dd>
            <dt>Período / data</dt><dd>{e.per_apur ? fmtComp(e.per_apur) : '—'} {e.data_ref ? `· ${data(e.data_ref)}` : ''}</dd>
            <dt>Retificação</dt><dd>{e.ind_retif === '2' ? `Retifica o recibo ${e.nr_recibo_retificado}` : e.tipo === 'S-3000' ? `Exclui o recibo ${e.nr_recibo_retificado}` : e.ind_retif === '1' ? 'Original' : '—'}</dd>
            {e.nr_rec_arq_base && (<><dt>Evento de origem</dt><dd className="mono">recibo {e.nr_rec_arq_base}</dd></>)}
            <dt>Validação XSD</dt><dd>{e.xsd_mensagem ?? 'Ainda não validado (importe o pacote XSD em Configurações).'}</dd>
            <dt>Hash do conteúdo</dt><dd className="mono pequeno">{e.hash_conteudo}</dd>
          </dl>
        </section>
        <section className="cartao">
          <h2>Recibo e arquivos de origem</h2>
          {e.recibo ? (
            <dl className="detalhes" style={{ marginTop: 12 }}>
              <dt>Nº do recibo</dt><dd className="mono">{e.recibo.nr_recibo}</dd>
              <dt>Resposta</dt><dd>{e.recibo.cd_resposta} {e.recibo.desc_resposta}</dd>
              <dt>Recepção</dt><dd>{dataHora(e.recibo.dh_recepcao)}</dd>
              <dt>Processamento</dt><dd>{dataHora(e.recibo.dh_processamento)}</dd>
              <dt>Protocolo</dt><dd className="mono">{e.recibo.protocolo ?? '—'}</dd>
            </dl>
          ) : <p className="suave" style={{ marginTop: 12 }}>Nenhum recibo deste evento consta nos arquivos importados.</p>}
          <h3 style={{ marginTop: 16 }}>Presente nos arquivos</h3>
          <ul className="pequeno">
            {e.ocorrencias.map((o, i) => <li key={i}><a href={`#/importacoes/${o.importacao_id}`}>Importação nº {o.importacao_id}</a> — <span className="mono">{o.nome_arquivo} › {o.caminho}</span></li>)}
          </ul>
          {!!e.relacionados.length && (
            <>
              <h3 style={{ marginTop: 16 }}>Eventos relacionados (retificação, exclusão, mesma chave)</h3>
              <ul className="pequeno">
                {e.relacionados.map((r) => <li key={r.id}><a href={`#/eventos/${r.id}`}>{r.tipo} {r.evento_id}</a> — {SITUACAO_EVENTO[r.situacao]?.rotulo ?? r.situacao}</li>)}
              </ul>
            </>
          )}
        </section>
      </div>
      <section className="cartao">
        <Tabs abas={[{ id: 'campos', rotulo: 'Campos do evento' }, { id: 'xml', rotulo: 'XML do evento' }]} ativa={aba} aoMudar={setAba} />
        <div style={{ marginTop: 12 }}>
          {aba === 'campos' ? <div className="arvore"><No no={e.arvore} /></div> : (
            <>
              <p className="legenda">Conteúdo do evento conforme lido do arquivo (namespaces normalizados). O arquivo original completo pode ser baixado na importação.</p>
              <pre className="xml">{e.xml.replace(/></g, '>\n<')}</pre>
            </>
          )}
        </div>
      </section>
    </>
  );
}
