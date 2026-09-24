import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Val } from '../../server/src/compartilhado/tipos';
import { api } from './api';

export interface Empresa {
  id: number;
  tp_insc: string;
  nr_insc: string;
  chave: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  documento_completo: string | null;
  perfil_acesso: string | null;
  autorizacao_obs: string | null;
  observacoes: string | null;
  origem_cadastro: string;
  estatisticas: { eventos: number; trabalhadores: number; ultima: string | null };
}

interface Notificacao {
  texto: string;
  tipo: 'sucesso' | 'erro' | 'info';
}

interface Ctx {
  empresa: string;
  setEmpresa: (e: string) => void;
  competencia: string;
  setCompetencia: (c: string) => void;
  empresas: Empresa[];
  competencias: string[];
  recarregarEmpresas: () => Promise<void>;
  origem: Val | null;
  abrirOrigem: (v: Val | null) => void;
  notificar: (texto: string, tipo?: Notificacao['tipo']) => void;
  notificacao: Notificacao | null;
  complementar: ComplementoPedido | null;
  pedirComplemento: (p: ComplementoPedido | null) => void;
  versaoDados: number;
  dadosAlterados: () => void;
}

export interface ComplementoPedido {
  escopo: string;
  referencia: string;
  campo: string;
  rotulo: string;
  formato?: string;
  aoSalvar?: () => void;
}

const Contexto = createContext<Ctx | null>(null);

function lerLocal(chave: string) {
  try {
    return localStorage.getItem(chave) ?? '';
  } catch {
    return '';
  }
}
function gravarLocal(chave: string, v: string) {
  try {
    localStorage.setItem(chave, v);
  } catch {
    /* sem armazenamento local: segue */
  }
}

export function ProvedorApp({ children }: { children: ReactNode }) {
  const [empresa, setEmpresaE] = useState(lerLocal('folha.empresa'));
  const [competencia, setCompetenciaE] = useState(lerLocal('folha.competencia'));
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [competencias, setCompetencias] = useState<string[]>([]);
  const [origem, abrirOrigem] = useState<Val | null>(null);
  const [notificacao, setNotificacao] = useState<Notificacao | null>(null);
  const [complementar, pedirComplemento] = useState<ComplementoPedido | null>(null);
  const [versaoDados, setVersao] = useState(0);

  const setEmpresa = (e: string) => {
    setEmpresaE(e);
    gravarLocal('folha.empresa', e);
  };
  const setCompetencia = (c: string) => {
    setCompetenciaE(c);
    gravarLocal('folha.competencia', c);
  };

  const recarregarEmpresas = useCallback(async () => {
    const lista = await api.get<Empresa[]>('/api/empresas');
    setEmpresas(lista);
    if (!lista.length) setEmpresa('');
    else if (!lista.some((e) => e.chave === empresa)) setEmpresa(lista[0].chave);
  }, [empresa]);

  useEffect(() => {
    recarregarEmpresas().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versaoDados]);

  useEffect(() => {
    if (!empresa) {
      setCompetencias([]);
      return;
    }
    api
      .get<string[]>(`/api/competencias?empresa=${encodeURIComponent(empresa)}`)
      .then((c) => {
        const mensais = c.filter((x) => /^\d{4}-\d{2}$/.test(x));
        setCompetencias(mensais);
        if (mensais.length && !mensais.includes(competencia)) setCompetencia(mensais[0]);
      })
      .catch(() => setCompetencias([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa, versaoDados]);

  const notificar = useCallback((texto: string, tipo: Notificacao['tipo'] = 'sucesso') => {
    setNotificacao({ texto, tipo });
    window.setTimeout(() => setNotificacao((n) => (n?.texto === texto ? null : n)), 6000);
  }, []);

  return (
    <Contexto.Provider
      value={{
        empresa,
        setEmpresa,
        competencia,
        setCompetencia,
        empresas,
        competencias,
        recarregarEmpresas,
        origem,
        abrirOrigem,
        notificar,
        notificacao,
        complementar,
        pedirComplemento,
        versaoDados,
        dadosAlterados: () => setVersao((v) => v + 1),
      }}
    >
      {children}
    </Contexto.Provider>
  );
}

export function useApp() {
  const c = useContext(Contexto);
  if (!c) throw new Error('Contexto ausente');
  return c;
}

/** Carrega dados assíncronos com estados de carregamento e erro. */
export function useCarregar<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);
    fn()
      .then((d) => vivo && setDados(d))
      .catch((e: Error) => vivo && setErro(e.message))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { dados, erro, carregando, recarregar: () => setN((x) => x + 1), setDados };
}

/** Rota baseada no hash (#/pagina/parametro). */
export function useRota(): [string[], (r: string) => void] {
  const ler = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [rota, setRota] = useState(ler());
  useEffect(() => {
    const f = () => setRota(ler());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return [rota, (r: string) => (window.location.hash = r.startsWith('#') ? r : `#/${r}`)];
}
