/**
 * Inicialização do serviço local.
 *   npm start               → http://127.0.0.1:5178 (abre o navegador)
 *   FOLHA_PORTA=5200        → outra porta
 *   FOLHA_DADOS_DIR=...     → outro diretório de dados
 *   --sem-navegador         → não abre o navegador
 */
import { spawn } from 'node:child_process';
import { criarApp, criarEstado } from './app.js';
import { carregarConfig } from './config.js';
import { importarArquivo } from './importacao/importador.js';
import { lerArquivoDaPasta, lerConfigPasta, listarPasta } from './servicos/pasta.js';
import { log } from './util/log.js';
import { validarPendentes } from './xsd/validador.js';

function abrirNavegador(url: string) {
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args as string[], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch {
    /* o usuário pode abrir manualmente */
  }
}

async function principal() {
  const cfg = carregarConfig();
  const estado = await criarEstado(cfg);
  const app = await criarApp(estado);
  await app.listen({ host: cfg.host, port: cfg.porta });
  const url = `http://127.0.0.1:${cfg.porta}`;
  log.info(`Folha eSocial Local em ${url} (acesso somente neste computador)`);
  log.info(`Dados locais em: ${estado.arm.dir}`);
  if (cfg.abrirNavegador && !cfg.dev) abrirNavegador(url);

  // Importação automática da pasta monitorada (somente se o usuário ativar)
  let ocupado = false;
  setInterval(async () => {
    if (ocupado) return;
    const c = lerConfigPasta(estado.arm);
    if (!c.ativo || !c.autoImportar || !c.caminho) return;
    ocupado = true;
    try {
      const arquivos = await listarPasta(estado.arm, cfg.maxUploadBytes);
      for (const a of arquivos) {
        if (a.jaImportado || (c.ativadoEm && a.modificadoEm < c.ativadoEm)) continue;
        const dados = await lerArquivoDaPasta(estado.arm, a.nome, cfg.maxUploadBytes);
        await importarArquivo(estado.arm, cfg, { nomeArquivo: a.nome, dados, origem: 'pasta_monitorada' });
      }
      await validarPendentes(estado.arm);
    } catch (e) {
      log.aviso('Falha ao verificar a pasta monitorada', { erro: (e as Error).message.slice(0, 100) });
    } finally {
      ocupado = false;
    }
  }, 15_000).unref();

  const encerrar = async () => {
    await app.close();
    estado.arm.fechar();
    process.exit(0);
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

principal().catch((e) => {
  log.erro(`Falha ao iniciar: ${(e as Error).message}`);
  process.exit(1);
});
