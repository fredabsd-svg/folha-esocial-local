import type { Documento, Tabela } from '../../../server/src/compartilhado/tipos';
import { api, qs } from '../api';
import { Carregando, Erro, ListaPendencias, SemEmpresa, TabelaDoc, Vazio } from '../componentes';
import { useApp, useCarregar } from '../contexto';
import { competencia as fmtComp } from '../formato';

export function Pendencias() {
  const { empresa, competencia, versaoDados } = useApp();
  const r = useCarregar(
    () => (empresa && competencia ? api.get<{ pendencias: Documento['pendencias']; divergencias: Tabela | null }>(`/api/pendencias${qs({ empresa, competencia })}`) : Promise.resolve(null)),
    [empresa, competencia, versaoDados],
  );
  if (!empresa) return <SemEmpresa />;
  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Pendências e divergências — {fmtComp(competencia)}</h1>
          <p>Eventos ausentes, dados não encontrados, cálculos incompletos e diferenças entre os valores do XML e o recálculo determinístico. Os XMLs nunca são alterados.</p>
        </div>
        <div className="barra-acoes">
          <a className="botao" href="#/relatorios/eventos_ausentes">Relatório de eventos ausentes</a>
          <a className="botao" href="#/relatorios/divergencias">Relatório de divergências</a>
        </div>
      </div>
      {r.carregando && !r.dados ? <Carregando /> : r.erro ? <Erro texto={r.erro} aoTentar={r.recarregar} /> : !r.dados ? (
        <Vazio titulo="Selecione uma competência" />
      ) : (
        <>
          <section className="cartao">
            <h2>Divergências e conferências incompletas</h2>
            {r.dados.divergencias?.linhas.length ? (
              <div style={{ marginTop: 12 }}><TabelaDoc colunas={r.dados.divergencias.colunas} linhas={r.dados.divergencias.linhas} /></div>
            ) : <p className="suave" style={{ marginTop: 12 }}>Nenhuma divergência entre XML e recálculo nesta competência.</p>}
          </section>
          <section className="cartao">
            {r.dados.pendencias.length ? <ListaPendencias pendencias={r.dados.pendencias} /> : <Vazio titulo="Nenhuma pendência encontrada" />}
          </section>
        </>
      )}
    </>
  );
}
