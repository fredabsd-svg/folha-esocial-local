import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ProvedorApp } from './contexto';
import './estilos.css';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ProvedorApp>
      <App />
    </ProvedorApp>
  </StrictMode>,
);
