// Ponto de entrada do frontend. Monta o app real (rotas + auth + react-query).

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Elemento #root não encontrado em index.html');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Service worker: só habilita a instalação na tela inicial — não cacheia nada
// (ver public/sw.js). Fica fora do StrictMode e do ciclo do React de propósito:
// é efeito de plataforma, não de componente.
//
// Só em produção. Em desenvolvimento, um SW no meio do caminho atrapalha o
// hot-reload do Vite e confunde o que está sendo servido.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      // Sem SW o app continua funcionando: perde-se só o "instalar".
      console.warn('[pwa] Falha ao registrar o service worker:', err);
    });
  });
}
