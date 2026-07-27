// Service worker MÍNIMO — existe para o sistema poder ser instalado na tela
// inicial do celular (pedido da reunião de 16/07/2026: "gerar em aplicativo,
// com ícone na tela inicial").
//
// ELE NÃO GUARDA CACHE. De propósito.
//
// O Chrome exige um service worker com listener de 'fetch' para oferecer a
// instalação do app. Um SW que cacheia arquivos resolveria offline, mas traria
// um problema pior para esta operação: o pessoal ficaria com uma versão VELHA
// do sistema presa no celular depois de cada deploy, sem entender por quê. Como
// o uso é sempre online (o painel só faz sentido com dados do Órix), o cache
// não compra nada e custa caro.
//
// Se um dia houver necessidade real de offline (motorista em área sem sinal),
// isso vira uma decisão consciente: cachear o shell do app COM versionamento e
// invalidação no deploy.

// Assume o controle já na primeira carga, sem esperar a aba ser fechada.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(self.clients.claim());
});

// Repasse puro: o listener precisa existir, mas não intercepta nada.
self.addEventListener('fetch', () => {
  // Sem respondWith() => o navegador segue o caminho normal da rede.
});
