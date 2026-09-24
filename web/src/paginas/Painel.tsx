import { useState } from 'react';
import { api } from '../api';
import { Carregando, Erro, Etiqueta } from '../componentes';
import { useApp, useCarregar } from '../contexto';
import { competencia as fmtComp, dataHora, moeda } from '../formato';

interface DadosPainel {
  geral: { empresas: number; importacoes: number; eventos: number; eventosInativos: number; relatorios: number };
  ultimasImportacoes: Array<{ id: number; nome_arquivo: string; importado_em: string; status: string; qtd_eventos: number; qtd_eventos_novos: number; periodo_inicio: string | null; periodo_fim: string | null }>;
  empresa?: {
    porTipo: Array<{ tipo: string; n: number }>;
    competencias: string[];
    resumo: Array<{ competencia: string; trabalhadores: number; proventos: number; descontos: number; liquido: number; pago: number; divergencias: number; pendencias: number; fechamento: string }>;
  };
}

export function Painel({ navegar }: { navegar: (r: string) => void }) {
  const { empresa, setCompetencia, notificar, dadosAlterados, versaoDados, setEmpresa } = useApp();
  const { dados, erro, carregando, recarregar } = useCarregar(
    () => api.get<DadosPainel>(`/api/painel${empresa ? `?empresa=${encodeURIComponent(empresa)}` : ''}`),
    [empresa, versaoDados],
  );
  const [demo, setDemo] = useState(false);

  const carregarDemo = async () => {
    setDemo(true);
    try {
      const r = await api.post<{ empresa: string }>('/api/demonstracao');
      setEmpresa(r.empresa);
      notificar('Dados fictícios de demonstração importados.');
      dadosAlterados();
    } catch (e) {
      notificar((e as Error).message, 'erro');
    } finally {
      setDemo(false);
    }
  };

  if (carregando && !dados) return <Carregando />;
  if (erro) return <Erro texto={erro} aoTentar={recarregar} />;
  if (!dados) return null;

  if (!dados.geral.empresas) {
    return (
      <>
        <div className="cabecalho-pagina">
          <div>
            <h1>Bem-vindo</h1>
            <p>Este sistema lê os XMLs do eSocial da sua carteira de empresas e gera relatórios de folha para conferência, mostrando a origem de cada valor. Tudo fica neste computador.</p>
          </div>
        </div>
        <section className="cartao">
          <h2>Comece em três passos</h2>
          <div className="etapas" style={{ marginTop: 16 }}>
            <div className="etapa"><span className="n">1</span><div><strong>Obtenha os XMLs</strong><p className="suave">Baixe pelo eSocial Download (portal oficial, com seu login Gov.br) ou use arquivos que você já tem.</p><a className="botao" href="#/obter">Ver como obter</a></div></div>
            <div className="etapa"><span className="n">2</span><div><strong>Importe o ZIP ou os XMLs</strong><p className="suave">O sistema preserva os originais, valida, evita duplicidade e identifica retificações e exclusões.</p><a className="botao primario" href="#/importacoes">Importar arquivos</a></div></div>
            <div className="etapa"><span className="n">3</span><div><strong>Confira e gere relatórios</strong><p className="suave">Extrato, movimentos, recibos, líquidos, resumo, férias, rescisão e outros, em PDF, XLSX e CSV.</p></div></div>
          </div>
          <hr />
          <div className="linha">
            <button className="botao" onClick={carregarDemo} disabled={demo}>{demo ? 'Carregando…' : 'Carregar demonstração com dados fictícios'}</button>
            <span className="legenda">Cria uma empresa e trabalhadores fictícios para você explorar as telas. Pode ser excluída depois.</span>
          </div>
        </section>
      </>
    );
  }

  const res = dados.empresa?.resumo ?? [];
  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Painel</h1>
          <p>Resumo das competências da empresa selecionada. Clique em uma competência para abrir os relatórios.</p>
        </div>
        <div className="barra-acoes">
          <a className="botao" href="#/importacoes">Importar XMLs</a>
          <a className="botao primario" href="#/relatorios">Gerar relatórios</a>
        </div>
      </div>
      <div className="grade grade-4">
        <div className="cartao indicador"><span className="rotulo">Eventos ativos</span><span className="valor">{dados.geral.eventos.toLocaleString('pt-BR')}</span><span className="legenda">{dados.geral.eventosInativos} retificados/excluídos/substituídos</span></div>
        <div className="cartao indicador"><span className="rotulo">Importações</span><span className="valor">{dados.geral.importacoes}</span></div>
        <div className="cartao indicador"><span className="rotulo">Empresas</span><span className="valor">{dados.geral.empresas}</span></div>
        <div className="cartao indicador"><span className="rotulo">Relatórios gerados</span><span className="valor">{dados.geral.relatorios}</span></div>
      </div>
      <section className="cartao">
        <div className="cartao-titulo"><h2>Competências</h2><span className="legenda">Valores somados dos demonstrativos (S-1200 e S-2299). Líquido pago = S-1210.</span></div>
        {!res.length ? (
          <p className="suave">Nenhuma remuneração importada para esta empresa.</p>
        ) : (
          <div className="tabela-rolagem">
            <table className="dados">
              <thead>
                <tr><th>Competência</th><th className="dir">Trabalhadores</th><th className="dir">Proventos</th><th className="dir">Descontos</th><th className="dir">Líquido calculado</th><th className="dir">Líquido pago</th><th>Situação</th><th>Fechamento</th></tr>
              </thead>
              <tbody>
                {res.map((r) => (
                  <tr key={r.competencia} className="clicavel" tabIndex={0} onClick={() => { setCompetencia(r.competencia); navegar('relatorios'); }} onKeyDown={(e) => e.key === 'Enter' && (setCompetencia(r.competencia), navegar('relatorios'))}>
                    <td><strong>{fmtComp(r.competencia)}</strong></td>
                    <td className="dir num">{r.trabalhadores}</td>
                    <td className="dir num">{moeda(r.proventos)}</td>
                    <td className="dir num">{moeda(r.descontos)}</td>
                    <td className="dir num">{moeda(r.liquido)}</td>
                    <td className="dir num">{moeda(r.pago)}</td>
                    <td>
                      {r.divergencias ? <Etiqueta classe="erro">{r.divergencias} divergência(s)</Etiqueta> : r.pendencias ? <Etiqueta classe="alerta">{r.pendencias} pendência(s)</Etiqueta> : <Etiqueta classe="ok">Sem pendências</Etiqueta>}
                    </td>
                    <td>{r.fechamento === 'fechada' ? <Etiqueta classe="ok">Fechada</Etiqueta> : <Etiqueta classe="alerta">{r.fechamento === 'reaberta' ? 'Reaberta' : 'Sem S-1299'}</Etiqueta>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="grade grade-2">
        <section className="cartao">
          <div className="cartao-titulo"><h2>Últimas importações</h2><a href="#/importacoes">Ver todas</a></div>
          <div className="tabela-rolagem">
            <table className="dados">
              <thead><tr><th>Arquivo</th><th>Data</th><th className="dir">Eventos</th><th className="dir">Novos</th><th>Situação</th></tr></thead>
              <tbody>
                {dados.ultimasImportacoes.map((i) => (
                  <tr key={i.id} className="clicavel" onClick={() => navegar(`importacoes/${i.id}`)}>
                    <td style={{ maxWidth: 240, overflowWrap: 'anywhere' }}>{i.nome_arquivo}</td>
                    <td>{dataHora(i.importado_em)}</td>
                    <td className="dir num">{i.qtd_eventos}</td>
                    <td className="dir num">{i.qtd_eventos_novos}</td>
                    <td><Etiqueta classe={i.status === 'concluida' ? 'ok' : i.status === 'rejeitada' ? 'erro' : 'alerta'}>{i.status.replace(/_/g, ' ')}</Etiqueta></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="cartao">
          <div className="cartao-titulo"><h2>Eventos ativos por tipo</h2><a href="#/eventos">Consultar eventos</a></div>
          <div className="linha">
            {(dados.empresa?.porTipo ?? []).map((t) => (
              <a key={t.tipo} className="etiqueta neutra" style={{ textDecoration: 'none', fontSize: 13, padding: '4px 10px' }} href={`#/eventos?tipo=${t.tipo}`} onClick={(e) => { e.preventDefault(); sessionStorage.setItem('folha.filtroTipo', t.tipo); navegar('eventos'); }}>
                {t.tipo}: {t.n}
              </a>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
