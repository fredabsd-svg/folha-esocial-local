/**
 * Cliente da API local. Toda chamada vai para o próprio computador
 * (mesma origem). O cabeçalho X-Folha-Local protege contra CSRF.
 */
export class ErroApi extends Error {
  constructor(
    readonly status: number,
    msg: string,
  ) {
    super(msg);
  }
}

async function tratar<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `Erro ${r.status}`;
    try {
      const j = await r.json();
      msg = j.erro ?? msg;
    } catch {
      /* resposta sem JSON */
    }
    throw new ErroApi(r.status, msg);
  }
  const tipo = r.headers.get('content-type') ?? '';
  return (tipo.includes('application/json') ? r.json() : r.text()) as Promise<T>;
}

const CAB = { 'X-Folha-Local': '1' };

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: <T>(url: string) => fetch(url, { credentials: 'same-origin' }).then((r) => tratar<T>(r)),
  post: <T>(url: string, corpo?: unknown) =>
    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...CAB, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo ?? {}),
    }).then((r) => tratar<T>(r)),
  put: <T>(url: string, corpo?: unknown) =>
    fetch(url, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { ...CAB, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo ?? {}),
    }).then((r) => tratar<T>(r)),
  del: <T>(url: string) => fetch(url, { method: 'DELETE', credentials: 'same-origin', headers: CAB }).then((r) => tratar<T>(r)),
  enviar: <T>(url: string, dados: FormData) =>
    fetch(url, { method: 'POST', credentials: 'same-origin', headers: CAB, body: dados }).then((r) => tratar<T>(r)),
};

function salvarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function nomeDaResposta(r: Response, padrao: string) {
  const cd = r.headers.get('content-disposition') ?? '';
  const m = /filename="([^"]+)"/.exec(cd);
  return m?.[1] ?? padrao;
}

/** Baixa um arquivo gerado localmente (POST com corpo JSON). */
export async function baixarPost(url: string, corpo: unknown, padrao = 'arquivo') {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { ...CAB, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) await tratar(r);
  salvarBlob(await r.blob(), nomeDaResposta(r, padrao));
}

export async function baixarGet(url: string, padrao = 'arquivo') {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) await tratar(r);
  salvarBlob(await r.blob(), nomeDaResposta(r, padrao));
}
