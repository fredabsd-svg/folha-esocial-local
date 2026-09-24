@echo off
chcp 65001 >nul
title Folha eSocial Local
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js LTS ^(versao 20, 22 ou 24^) em https://nodejs.org e execute novamente.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias ^(primeira execucao^)...
  call npm install --no-audit --no-fund || goto erro
)
if not exist "server\dist\index.js" (
  echo Compilando o sistema...
  call npm run build || goto erro
)
if not exist "web\dist\index.html" (
  echo Compilando a interface...
  call npm run build || goto erro
)

echo.
echo Iniciando em http://127.0.0.1:5178  ^(acesso somente neste computador^)
echo Para encerrar, feche esta janela ou pressione Ctrl+C.
echo.
node server\dist\index.js
goto fim

:erro
echo.
echo Ocorreu um erro. Verifique as mensagens acima.
pause
exit /b 1

:fim
