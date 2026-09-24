import { useState } from 'react';
import { GavetaOrigem, ModalComplemento, Notificacao } from './componentes';
import { useApp, useRota } from './contexto';
import { competencia as fmtComp, documentoEmpresa } from './formato';
import { Complementos } from './paginas/Complementos';
import { Configuracoes } from './paginas/Configuracoes';
import { Empresas } from './paginas/Empresas';
import { Eventos } from './paginas/Eventos';
import { Importacoes } from './paginas/Importacoes';
import { ObterXmls } from './paginas/ObterXmls';
import { Painel } from './paginas/Painel';
import { Pendencias } from './paginas/Pendencias';
import { Relatorios } from './paginas/Relatorios';
import { Trabalhadores } from './paginas/Trabalhadores';

const MENU: Array<{ grupo?: string; id: string; rotulo: string }> = [
  { id: 'painel', rotulo: 'Painel' },
  { grupo: 'Dados', id: 'obter', rotulo: 'Obter XMLs (eSocial)' },
  { id: 'importacoes', rotulo: 'Importações' },
  { id: 'eventos', rotulo: 'Eventos' },
  { id: 'trabalhadores', rotulo: 'Trabalhadores' },
  { grupo: 'Conferência', id: 'relatorios', rotulo: 'Relatórios' },
  { id: 'pendencias', rotulo: 'Pendências e divergências' },
  { id: 'complementos', rotulo: 'Complementos' },
  { grupo: 'Cadastros', id: 'empresas', rotulo: 'Empresas' },
  { id: 'configuracoes', rotulo: 'Configurações' },
];

export function App() {
  const [rota, navegar] = useRota();
  const [menuAberto, setMenuAberto] = useState(false);
  const { empresa, setEmpresa, empresas, competencia, setCompetencia, competencias } = useApp();
  const pagina = rota[0] ?? 'painel';

  const conteudo = (() => {
    switch (pagina) {
      case 'obter':
        return <ObterXmls />;
      case 'importacoes':
        return <Importacoes id={rota[1]} />;
      case 'eventos':
        return <Eventos id={rota[1]} />;
      case 'trabalhadores':
        return <Trabalhadores cpf={rota[1]} />;
      case 'relatorios':
        return <Relatorios tipo={rota[1]} auto={rota[2] === 'previa'} />;
      case 'pendencias':
        return <Pendencias />;
      case 'complementos':
        return <Complementos />;
      case 'empresas':
        return <Empresas />;
      case 'configuracoes':
        return <Configuracoes aba={rota[1]} />;
      default:
        return <Painel navegar={navegar} />;
    }
  })();

  return (
    <div className="app">
      <nav className={`menu ${menuAberto ? 'aberto' : ''}`} aria-label="Navegação principal">
        <div className="marca">
          <img src="/logo.svg" width="32" height="32" alt="" />
          <div>
            <strong>Folha eSocial</strong>
            <small>Relatórios a partir dos XMLs</small>
          </div>
        </div>
        {MENU.map((m) => (
          <div key={m.id}>
            {m.grupo && <div className="grupo">{m.grupo}</div>}
            <a href={`#/${m.id}`} aria-current={pagina === m.id ? 'page' : undefined} onClick={() => setMenuAberto(false)}>
              {m.rotulo}
            </a>
          </div>
        ))}
        <div className="rodape-menu">Funciona apenas neste computador. Nenhum dado é enviado para fora.</div>
      </nav>
      <div className="principal">
        <header className="topo">
          <button className="botao botao-menu" type="button" aria-expanded={menuAberto} onClick={() => setMenuAberto(!menuAberto)}>Menu</button>
          <div className="contexto">
            <div className="campo">
              <label htmlFor="sel-empresa">Empresa</label>
              <select id="sel-empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)} style={{ minWidth: 260 }}>
                {!empresas.length && <option value="">Nenhuma empresa importada</option>}
                {empresas.map((e) => (
                  <option key={e.chave} value={e.chave}>
                    {(e.razao_social ?? 'Sem razão social') + ' — ' + documentoEmpresa(e.chave, e.documento_completo)}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="sel-comp">Competência</label>
              <select id="sel-comp" value={competencia} onChange={(e) => setCompetencia(e.target.value)} disabled={!competencias.length}>
                {!competencias.length && <option value="">—</option>}
                {competencias.map((c) => <option key={c} value={c}>{fmtComp(c)}</option>)}
              </select>
            </div>
          </div>
          <span className="selo-local" title="O serviço aceita conexões somente deste computador (127.0.0.1)">● Local e privado</span>
        </header>
        <main className="conteudo">{conteudo}</main>
      </div>
      <GavetaOrigem />
      <ModalComplemento />
      <Notificacao />
    </div>
  );
}
