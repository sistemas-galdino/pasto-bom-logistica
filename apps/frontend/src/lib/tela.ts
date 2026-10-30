// "Estou no app do celular?" — a mesma fronteira da BarraInferior (abaixo do
// `md` do Tailwind, 768px). Para os poucos comportamentos que mudam no
// celular e não cabem numa classe CSS: valor padrão de tela, rótulo de gráfico.

import { useEffect, useState } from 'react';

const CONSULTA_CELULAR = '(max-width: 767px)';

/** Leitura pontual — para valor inicial de estado. */
export function ehCelular(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(CONSULTA_CELULAR).matches;
}

/** Acompanha a largura: muda se a tela girar ou a janela for redimensionada. */
export function useEhCelular(): boolean {
  const [celular, setCelular] = useState(ehCelular);
  useEffect(() => {
    const mq = window.matchMedia(CONSULTA_CELULAR);
    const aoMudar = () => setCelular(mq.matches);
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);
  return celular;
}
