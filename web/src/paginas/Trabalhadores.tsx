import { useState } from 'react';
import type { Val } from '../../../server/src/compartilhado/tipos';
import { api, qs } from '../api';
import { Carregando, Erro, Etiqueta, SemEmpresa, Valor, Vazio } from '../componentes';
import { useApp, useCarregar } from '../contexto';
import { competencia as fmtComp, cpf as fmtCpf, data, moeda, SITUACAO_EVENTO } from '../formato';

interface Linha {
  cpf: string;
  nome: Val;
  matricula: string | null;
  categoria: string | null;
  cargo: string | null;
  admissao: string | null;
  desligamento: string | null;
  ultimaRemuneracao: string | null;
  situacao: string | null;
  liquido: number | null;
  pendencias: number | null;
}

export function Trabalhadores({ cpf }: { cpf?: string }) {
  const { empresa } = useApp();
  if (!empresa) return <SemEmpresa />;
  if (cpf) return <Detalhe cpf={cpf} />;
  return <Lista />;
}

function Lista() {
  const { empresa, competencia, versaoDados } = useApp();
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const r = useCarregar(() => api.get<Linha[]>(`/api/trabalhadores${qs({ empresa, competencia, q })}`), [empresa, competencia, q, versaoDados]);
  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Trabalhadores</h1>
          <p>Vínculos (S-2200/S-2300) e pessoas com remuneração (S-1200) da empresa. Situação, líquido e pendências referem-se à competência {fmtComp(competencia)}.</p>
        </div>
        <form className="linha" onSubmit={(e) => { e.preventDefault(); setQ(busca); }}>
          <label className="sr-only" htmlFor="busca-trab">Buscar trabalhador</label>
          <input id="busca-trab" type="search" placeholder="Nome, CPF ou matrícula" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <button className="botao" type="submit">Buscar</button>
        </form>
      </div>
      <section className="cartao">
        {r.carregando && !r.dados ? <Carregando /> : r.erro ? <Erro texto={r.erro} /> : !r.dados?.length ? <Vazio titulo="Nenhum trabalhador encontrado" /> : (
          <div className="tabela-rolagem">
            <table className="dados">
              <thead><tr><th>Nome</th><th>CPF</th><th>Matrícula</th><th>Categoria</th><th>Cargo</th><th>Admissão</th><th>Situação na competência</th><th className="dir">Líquido calculado</th><th>Pendências</th></tr></thead>
              <tbody>
                {r.dados.map((t) => (
                  <tr key={t.cpf} className="clicavel" tabIndex={0} onClick={() => (window.location.hash = `#/trabalhadores/${t.cpf}`)} onKeyDown={(e) => e.key === 'Enter' && (window.location.hash = `#/trabalhadores/${t.cpf}`)}>
                    <td><Valor c={t.nome} /></td>
                    <td className="num">{fmtCpf(t.cpf)}</td>
                    <td>{t.matricula ?? '—'}</td>
                    <td>{t.categoria ?? '—'}</td>
                    <td>{t.cargo ?? '—'}</td>
                    <td>{data(t.admissao) || '—'}</td>
                    <td>{t.situacao ?? '—'}</td>
                    <td className="dir num">{moeda(t.liquido)}</td>
                    <td>{t.pendencias === null ? '—' : t.pendencias ? <Etiqueta classe="alerta">{t.pendencias}</Etiqueta> : <Etiqueta classe="ok">0</Etiqueta>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

interface DetalheT {
  cpf: string;
  nome: Val;
  nascimento: Val;
  dependentesIrrf: Val;
  vinculos: Array<{ matricula?: string; origem: string; inicio?: string; categoria?: string; eventoPk: number }>;
  historicoContratual: Array<{ eventoPk: number; tipo: string; data?: string; cargo: Val; salario: Val; categoria: Val }>;
  afastamentos: Array<{ inicio: string | null; fim: string | null; motivo: string | null; periodoAquisitivo: string | null; eventoPk?: number }>;
  desligamento: { data?: string; tipo: string; eventoPk: number } | null;
  remuneracoes: Array<{ competencia: string; indApuracao: string; proventos?: Val; descontos?: Val; liquido?: Val; pago?: Val; demonstrativos: string[]; divergencias: number }>;
  pagamentos: Array<{ dtPgto: Val; tpPgto: string; perRef: string; ideDmDev: string; vrLiq: Val; eventoPk: number }>;
  eventos: Array<{ id: number; evento_id: string; tipo: string; per_apur: string | null; data_ref: string | null; situacao: string }>;
}

function Detalhe({ cpf }: { cpf: string }) {
  const { empresa, setCompetencia } = useApp();
  const r = useCarregar(() => api.get<DetalheT>(`/api/trabalhadores/${cpf}${qs({ empresa })}`), [cpf, empresa]);
  if (r.carregando && !r.dados) return <Carregando />;
  if (r.erro) return <Erro texto={r.erro} />;
  const t = r.dados!;
  const abrirExtrato = (c: string) => {
    setCompetencia(c);
    try {
      sessionStorage.setItem('folha.trabalhador', cpf);
    } catch {
      /* sem armazenamento */
    }
    window.location.hash = '#/relatorios/extrato';
  };
  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <a href="#/trabalhadores">← Trabalhadores</a>
          <h1 style={{ marginTop: 8 }}><Valor c={t.nome} /></h1>
          <p className="num">CPF {fmtCpf(t.cpf)}</p>
        </div>
      </div>
      <div className="grade grade-3">
        <section className="cartao">
          <h2>Cadastro</h2>
          <dl className="detalhes" style={{ marginTop: 12 }}>
            <dt>Nascimento</dt><dd><Valor c={t.nascimento} /></dd>
            <dt>Dependentes para IRRF</dt><dd><Valor c={t.dependentesIrrf} /></dd>
            <dt>Vínculos</dt>
            <dd>{t.vinculos.length ? t.vinculos.map((v, i) => <div key={i}><a href={`#/eventos/${v.eventoPk}`}>{v.origem}</a> · matrícula {v.matricula ?? '—'} · início {data(v.inicio)} · categoria {v.categoria}</div>) : 'Nenhum S-2200/S-2300 importado'}</dd>
            <dt>Desligamento</dt><dd>{t.desligamento ? <a href={`#/eventos/${t.desligamento.eventoPk}`}>{t.desligamento.tipo} em {data(t.desligamento.data)}</a> : '—'}</dd>
          </dl>
        </section>
        <section className="cartao" style={{ gridColumn: 'span 2' }}>
          <h2>Histórico contratual</h2>
          {!t.historicoContratual.length ? <p className="suave">Sem eventos de admissão/alteração contratual.</p> : (
            <div className="tabela-rolagem" style={{ marginTop: 12 }}>
              <table className="dados">
                <thead><tr><th>Evento</th><th>Data</th><th>Cargo</th><th className="dir">Salário</th><th>Categoria</th></tr></thead>
                <tbody>{t.historicoContratual.map((h, i) => <tr key={i}><td><a href={`#/eventos/${h.eventoPk}`}>{h.tipo}</a></td><td>{data(h.data)}</td><td><Valor c={h.cargo} /></td><td className="dir"><Valor c={h.salario} /></td><td><Valor c={h.categoria} /></td></tr>)}</tbody>
              </table>
            </div>
          )}
          <h2 style={{ marginTop: 16 }}>Afastamentos</h2>
          {!t.afastamentos.length ? <p className="suave">Nenhum S-2230 ativo.</p> : (
            <div className="tabela-rolagem" style={{ marginTop: 12 }}>
              <table className="dados">
                <thead><tr><th>Início</th><th>Término</th><th>Motivo</th><th>Período aquisitivo</th></tr></thead>
                <tbody>{t.afastamentos.map((a, i) => <tr key={i}><td>{a.eventoPk ? <a href={`#/eventos/${a.eventoPk}`}>{data(a.inicio) || '—'}</a> : data(a.inicio)}</td><td>{data(a.fim) || 'não informado'}</td><td>{a.motivo ?? '—'}</td><td>{a.periodoAquisitivo ?? '—'}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <section className="cartao">
        <h2>Remunerações por competência</h2>
        {!t.remuneracoes.length ? <p className="suave">Nenhum S-1200 ativo.</p> : (
          <div className="tabela-rolagem" style={{ marginTop: 12 }}>
            <table className="dados">
              <thead><tr><th>Competência</th><th>Demonstrativos</th><th className="dir">Proventos</th><th className="dir">Descontos</th><th className="dir">Líquido calculado</th><th className="dir">Líquido pago</th><th>Situação</th><th></th></tr></thead>
              <tbody>
                {t.remuneracoes.map((m) => (
                  <tr key={m.competencia + m.indApuracao}>
                    <td>{fmtComp(m.competencia)}{m.indApuracao === '2' ? ' (13º)' : ''}</td>
                    <td>{m.demonstrativos.join(', ')}</td>
                    <td className="dir"><Valor c={m.proventos} /></td>
                    <td className="dir"><Valor c={m.descontos} /></td>
                    <td className="dir"><Valor c={m.liquido} /></td>
                    <td className="dir"><Valor c={m.pago} /></td>
                    <td>{m.divergencias ? <Etiqueta classe="erro">{m.divergencias} divergência(s)</Etiqueta> : <Etiqueta classe="ok">Sem divergência</Etiqueta>}</td>
                    <td>{m.indApuracao === '1' && <button className="botao pequeno" onClick={() => abrirExtrato(m.competencia)}>Extrato</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="grade grade-2">
        <section className="cartao">
          <h2>Pagamentos (S-1210)</h2>
          {!t.pagamentos.length ? <p className="suave">Nenhum S-1210 ativo.</p> : (
            <div className="tabela-rolagem" style={{ marginTop: 12 }}>
              <table className="dados">
                <thead><tr><th>Data</th><th>Tipo</th><th>Período de referência</th><th>Demonstrativo</th><th className="dir">Líquido</th></tr></thead>
                <tbody>{t.pagamentos.map((p, i) => <tr key={i}><td><Valor c={p.dtPgto} /></td><td>{p.tpPgto}</td><td>{fmtComp(p.perRef)}</td><td>{p.ideDmDev}</td><td className="dir"><Valor c={p.vrLiq} /></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
        <section className="cartao">
          <h2>Eventos do trabalhador</h2>
          <div className="tabela-rolagem" style={{ marginTop: 12, maxHeight: 360 }}>
            <table className="dados">
              <thead><tr><th>Tipo</th><th>Período / data</th><th>Situação</th></tr></thead>
              <tbody>{t.eventos.map((e) => <tr key={e.id} className="clicavel" onClick={() => (window.location.hash = `#/eventos/${e.id}`)}><td>{e.tipo}</td><td>{e.per_apur ? fmtComp(e.per_apur) : data(e.data_ref)}</td><td><Etiqueta classe={SITUACAO_EVENTO[e.situacao]?.classe ?? 'neutra'}>{SITUACAO_EVENTO[e.situacao]?.rotulo ?? e.situacao}</Etiqueta></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
