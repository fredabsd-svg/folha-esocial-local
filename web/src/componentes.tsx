import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Celula, Coluna, Documento, Formato, Linha, Val } from '../../server/src/compartilhado/tipos';
import { api } from './api';
import { useApp } from './contexto';
import { competencia as fmtComp, dataHora, ehVal, NOME_ORIGEM, ROTULO_ORIGEM, textoCelula } from './formato';

// ------------------------------------------------------------------ valor com origem
export function Valor({ c, f }: { c: Celula | undefined; f?: Formato }) {
  const { abrirOrigem } = useApp();
  if (!ehVal(c)) return <span className="num">{textoCelula(c ?? null, f)}</span>;
  const texto = textoCelula(c, f);
  return (
    <span className={`valor ${c.o}`}>
      <span className="texto num">{texto}</span>
      <button
        type="button"
        className="origem"
        title={`${NOME_ORIGEM[c.o]} — clique para ver a origem`}
        aria-label={`Origem: ${NOME_ORIGEM[c.o]}. Ver detalhes.`}
        onClick={(e) => {
          e.stopPropagation();
          abrirOrigem(c);
        }}
      >
        {ROTULO_ORIGEM[c.o]}
      </button>
    </span>
  );
}

export function LegendaOrigem() {
  return (
    <div className="legenda-origem" aria-label="Legenda de origem dos valores">
      <span className="valor xml"><button type="button" className="origem" tabIndex={-1}>XML</button> veio do XML importado</span>
      <span className="valor calculado"><button type="button" className="origem" tabIndex={-1}>CALC</button> calculado pelo sistema</span>
      <span className="valor complementado"><button type="button" className="origem" tabIndex={-1}>COMP</button> informado pelo usuário</span>
      <span className="valor ausente"><button type="button" className="origem" tabIndex={-1}>AUSENTE</button> não encontrado</span>
      <span>“—” não se aplica</span>
    </div>
  );
}

export function GavetaOrigem() {
  const { origem: v, abrirOrigem, pedirComplemento } = useApp();
  if (!v) return null;
  return (
    <Gaveta titulo="Origem do valor" aoFechar={() => abrirOrigem(null)}>
      <div className={`valor ${v.o}`} style={{ fontSize: 'var(--t-subtitulo)' }}>
        <span className="texto num">{textoCelula(v)}</span>
        <button type="button" className="origem">{ROTULO_ORIGEM[v.o]}</button>
      </div>
      <p className="suave">{NOME_ORIGEM[v.o]}</p>
      {v.x && (
        <dl className="detalhes">
          <dt>Evento</dt>
          <dd>{v.x.tipoEvento}</dd>
          <dt>Id do evento</dt>
          <dd className="mono">{v.x.eventoId}</dd>
          <dt>Recibo</dt>
          <dd className="mono">{v.x.recibo ?? 'sem recibo nos arquivos importados'}</dd>
          <dt>Campo no XML</dt>
          <dd className="mono">{v.x.campo}</dd>
          <dt>Arquivo</dt>
          <dd className="mono">{v.x.arquivo ?? '—'}</dd>
          {v.x.importacaoId && (
            <>
              <dt>Importação</dt>
              <dd>
                <a href={`#/importacoes/${v.x.importacaoId}`} onClick={() => abrirOrigem(null)}>nº {v.x.importacaoId}</a>
              </dd>
            </>
          )}
        </dl>
      )}
      {v.c && (
        <div className="pilha">
          <dl className="detalhes">
            <dt>Regra</dt>
            <dd>{v.c.regra} (versão {v.c.versao})</dd>
            <dt>Fórmula</dt>
            <dd>{v.c.formula}</dd>
            {v.c.tabela && (
              <>
                <dt>Tabela</dt>
                <dd>{v.c.tabela.id} v{v.c.tabela.versao} — {v.c.tabela.fonte}</dd>
              </>
            )}
            {v.c.parametros &&
              Object.entries(v.c.parametros).map(([k, p]) => (
                <FragmentoParam key={k} k={k} v={p} />
              ))}
          </dl>
          {!!v.c.memoria?.length && (
            <div className="tabela-rolagem">
              <table className="dados">
                <thead><tr><th>Memória de cálculo</th><th className="dir">Valor</th></tr></thead>
                <tbody>
                  {v.c.memoria.map((m, i) => (
                    <tr key={i}><td>{m.descricao}</td><td className="dir num">{typeof m.valor === 'number' ? m.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : m.valor}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!!v.c.fontes?.length && (
            <div className="pequeno">
              <strong>Valores do XML usados:</strong>
              <ul>{v.c.fontes.map((f, i) => <li key={i} className="mono">{f.tipoEvento} {f.eventoId} — {f.campo}</li>)}</ul>
            </div>
          )}
          {!!v.c.incompleto?.length && (
            <div className="aviso alerta"><div><strong>Cálculo incompleto ou com ressalvas</strong><ul>{v.c.incompleto.map((x, i) => <li key={i}>{x}</li>)}</ul></div></div>
          )}
        </div>
      )}
      {v.m && (
        <dl className="detalhes">
          <dt>Fonte informada</dt>
          <dd>{v.m.origem}</dd>
          <dt>Registrado em</dt>
          <dd>{v.m.informadoEm ? dataHora(v.m.informadoEm) : 'cadastro da empresa'}</dd>
        </dl>
      )}
      {v.obs && <div className="aviso info"><div>{v.obs}</div></div>}
      {v.o === 'ausente' && v.comp && (
        <button className="botao primario" type="button" onClick={() => { pedirComplemento({ ...v.comp!, formato: v.f }); abrirOrigem(null); }}>
          Informar “{v.comp.rotulo}”
        </button>
      )}
    </Gaveta>
  );
}

function FragmentoParam({ k, v }: { k: string; v: unknown }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className="num">{v === null ? '—' : typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : String(v)}</dd>
    </>
  );
}

// ------------------------------------------------------------------ estruturas
export function Gaveta({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aoFechar]);
  return (
    <div className="fundo-modal" onClick={aoFechar}>
      <div className="gaveta" role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="cabecalho-gaveta">
          <h2>{titulo}</h2>
          <button className="botao pequeno" type="button" onClick={aoFechar}>Fechar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Modal({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aoFechar]);
  return (
    <div className="fundo-modal centro" onClick={aoFechar}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <div className="cabecalho-gaveta">
          <h2>{titulo}</h2>
          <button className="botao pequeno" type="button" onClick={aoFechar}>Fechar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return <div className="carregando" role="status">{texto}</div>;
}

export function Erro({ texto, aoTentar }: { texto: string; aoTentar?: () => void }) {
  return (
    <div className="aviso erro" role="alert">
      <div>
        <strong>Não foi possível concluir</strong>
        {texto}
        {aoTentar && <div style={{ marginTop: 8 }}><button className="botao pequeno" onClick={aoTentar}>Tentar novamente</button></div>}
      </div>
    </div>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="vazio">
      <strong>{titulo}</strong>
      {children}
    </div>
  );
}

export function Etiqueta({ classe, children }: { classe: string; children: ReactNode }) {
  return <span className={`etiqueta ${classe}`}>{children}</span>;
}

export function Campo({ rotulo, id, ajuda, children }: { rotulo: string; id?: string; ajuda?: string; children: ReactNode }) {
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      {children}
      {ajuda && <span className="ajuda">{ajuda}</span>}
    </div>
  );
}

export function SemEmpresa() {
  return (
    <Vazio titulo="Nenhuma empresa selecionada">
      <p>Importe XMLs do eSocial (ou carregue a demonstração) para que as empresas apareçam aqui.</p>
      <a className="botao primario" href="#/importacoes">Ir para Importações</a>
    </Vazio>
  );
}

// ------------------------------------------------------------------ tabela de documento
export function TabelaDoc({ colunas, linhas }: { colunas: Coluna[]; linhas: Linha[] }) {
  return (
    <div className="tabela-rolagem">
      <table className="dados">
        <thead>
          <tr>{colunas.map((c) => <th key={c.id} className={c.alinhar === 'dir' ? 'dir' : ''}>{c.rotulo}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => {
            if (l.tipo === 'grupo') {
              const t = colunas.map((c) => l.c[c.id]).filter((x) => x !== undefined && x !== null);
              return (
                <tr key={i} className="grupo">
                  <td colSpan={colunas.length}>{t.map((x, j) => <span key={j} style={{ marginRight: 12 }}><Valor c={x} /></span>)}</td>
                </tr>
              );
            }
            const destaque = l.tipo === 'subtotal' || l.tipo === 'total';
            return (
              <tr key={i} className={l.tipo ?? ''}>
                {colunas.map((c) => {
                  const cel = l.c[c.id];
                  return (
                    <td key={c.id} className={c.alinhar === 'dir' ? 'dir' : ''}>
                      {cel === undefined || (cel === null && destaque) ? '' : <Valor c={cel} f={c.tipo} />}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ documento
export function DocumentoView({ doc, mostrarOrigem = true }: { doc: Documento; mostrarOrigem?: boolean }) {
  return (
    <article className={`documento ${mostrarOrigem ? '' : 'sem-origem'}`} aria-label={doc.titulo}>
      <div className="doc-topo">
        <div className="pilha" style={{ gap: 4 }}>
          <h1>{doc.titulo}</h1>
          {doc.subtitulo && <span className="suave">{doc.subtitulo}</span>}
          <span className="legenda">Gerado em {dataHora(doc.geradoEm)}</span>
        </div>
        {(doc.marca?.nome || doc.marca?.logoDataUrl) && (
          <div className="linha">
            {doc.marca?.logoDataUrl && <img src={doc.marca.logoDataUrl} alt={`Logotipo de ${doc.marca.nome ?? 'escritório'}`} />}
            <div className="pequeno"><strong>{doc.marca?.nome}</strong><div className="suave">{[doc.marca?.documento, doc.marca?.contato].filter(Boolean).join(' · ')}</div></div>
          </div>
        )}
      </div>
      <div className="campos c4">
        {doc.cabecalho.map((c, i) => (
          <div className="item" key={i}><span className="rotulo">{c.rotulo}</span><Valor c={c.val} /></div>
        ))}
      </div>
      <div className="aviso previa">{doc.aviso}</div>
      {doc.blocos.map((b, i) => (
        <section key={i} className={`bloco ${b.destaque ?? ''} ${b.quebraPagina ? 'quebra' : ''}`}>
          {b.titulo && <h2>{b.titulo}</h2>}
          {b.subtitulo && <p className="suave">{b.subtitulo}</p>}
          {!!b.campos?.length && (
            <div className={`campos c${b.colunasCampos ?? 3}`}>
              {b.campos.map((c, j) => (
                <div className="item" key={j}><span className="rotulo">{c.rotulo}</span><Valor c={c.val} /></div>
              ))}
            </div>
          )}
          {b.tabela && <TabelaDoc colunas={b.tabela.colunas} linhas={b.tabela.linhas} />}
          {!!b.notas?.length && <div className="notas">{b.notas.map((n, j) => <p key={j}>{n}</p>)}</div>}
          {!!b.assinaturas?.length && (
            <div>
              <p className="pequeno">{b.assinaturas[0]}</p>
              <div className="assinaturas">{b.assinaturas.slice(1).map((a, j) => <span key={j}>{a}</span>)}</div>
            </div>
          )}
        </section>
      ))}
      {!!doc.pendencias.length && <ListaPendencias pendencias={doc.pendencias} />}
      {mostrarOrigem && <LegendaOrigem />}
    </article>
  );
}

const NIVEL: Record<string, { rotulo: string; classe: string }> = {
  erro: { rotulo: 'Erro', classe: 'erro' },
  alerta: { rotulo: 'Alerta', classe: 'alerta' },
  info: { rotulo: 'Informação', classe: 'info' },
};
const CATEGORIA: Record<string, string> = {
  ausente: 'Dado ausente',
  divergencia: 'Divergência',
  evento_ausente: 'Evento ausente',
  calculo_incompleto: 'Cálculo incompleto',
  validacao: 'Validação',
  duplicidade: 'Duplicidade',
  ambiente: 'Ambiente',
};

export function ListaPendencias({ pendencias }: { pendencias: Documento['pendencias'] }) {
  const [filtro, setFiltro] = useState('');
  const lista = useMemo(() => pendencias.filter((p) => !filtro || p.nivel === filtro), [pendencias, filtro]);
  return (
    <section className="bloco">
      <div className="cartao-titulo">
        <h2>Pendências ({pendencias.length})</h2>
        <div className="linha">
          <label className="sr-only" htmlFor="filtro-pend">Filtrar por nível</label>
          <select id="filtro-pend" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="">Todos os níveis</option>
            <option value="erro">Erros</option>
            <option value="alerta">Alertas</option>
            <option value="info">Informações</option>
          </select>
        </div>
      </div>
      <div className="tabela-rolagem">
        <table className="dados">
          <thead><tr><th>Nível</th><th>Categoria</th><th>Trabalhador</th><th>Competência</th><th>Descrição</th></tr></thead>
          <tbody>
            {lista.map((p, i) => (
              <tr key={i}>
                <td><Etiqueta classe={NIVEL[p.nivel].classe}>{NIVEL[p.nivel].rotulo}</Etiqueta></td>
                <td>{CATEGORIA[p.categoria] ?? p.categoria}</td>
                <td>{p.nome || p.cpf || '—'}</td>
                <td>{fmtComp(p.competencia) || '—'}</td>
                <td>{p.mensagem}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ complementar dado ausente
export function ModalComplemento() {
  const { complementar: p, pedirComplemento, empresa, notificar, dadosAlterados } = useApp();
  const [valor, setValor] = useState('');
  const [origem, setOrigem] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    setValor('');
    setOrigem('');
    setErro('');
  }, [p]);
  if (!p) return null;
  const tipo = p.formato === 'data' ? 'date' : 'text';
  const salvar = async () => {
    setErro('');
    let v = valor.trim();
    if (p.formato === 'moeda' || p.formato === 'inteiro') {
      const n = Number(v.replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n)) return setErro('Informe um número válido (ex.: 1234,56).');
      v = String(n);
    }
    setSalvando(true);
    try {
      await api.post('/api/complementos', { empresa, escopo: p.escopo, referencia: p.referencia, campo: p.campo, valor: v, origem });
      notificar('Complemento registrado. O valor aparecerá como “COMP” nos relatórios.');
      p.aoSalvar?.();
      dadosAlterados();
      pedirComplemento(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal titulo={`Complementar: ${p.rotulo}`} aoFechar={() => pedirComplemento(null)}>
      <div className="aviso info">
        <div>O valor será identificado nos relatórios como <strong>complementado pelo usuário</strong>, com a origem e a data informadas. Ele não altera nenhum XML.</div>
      </div>
      <Campo rotulo={p.rotulo} id="comp-valor">
        <input id="comp-valor" type={tipo} value={valor} onChange={(e) => setValor(e.target.value)} autoFocus />
      </Campo>
      <Campo rotulo="Origem da informação" id="comp-origem" ajuda="Ex.: “Aviso de férias assinado, arquivo do cliente”, “Extrato FGTS Digital de 20/08/2026”.">
        <input id="comp-origem" type="text" value={origem} onChange={(e) => setOrigem(e.target.value)} />
      </Campo>
      {erro && <Erro texto={erro} />}
      <div className="linha fim">
        <button className="botao" onClick={() => pedirComplemento(null)}>Cancelar</button>
        <button className="botao primario" disabled={!valor.trim() || !origem.trim() || salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar complemento'}
        </button>
      </div>
    </Modal>
  );
}

export function Notificacao() {
  const { notificacao } = useApp();
  if (!notificacao) return null;
  return (
    <div className={`toast aviso ${notificacao.tipo}`} role="status" aria-live="polite">
      <div>{notificacao.texto}</div>
    </div>
  );
}

export function Tabs<T extends string>({ abas, ativa, aoMudar }: { abas: Array<{ id: T; rotulo: string }>; ativa: T; aoMudar: (a: T) => void }) {
  return (
    <div className="abas" role="tablist">
      {abas.map((a) => (
        <button key={a.id} role="tab" type="button" aria-selected={a.id === ativa} onClick={() => aoMudar(a.id)}>{a.rotulo}</button>
      ))}
    </div>
  );
}

export type { Val };
