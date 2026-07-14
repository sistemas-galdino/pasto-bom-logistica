// Marca Rede do Campo / Pasto Bom.
//
// Dois usos, porque o logo oficial é panorâmico (sol + colinas + palavra) e não
// sobrevive a um ícone de 36px nem a um fundo verde-escuro (a tipografia dele é
// marrom):
//   <Marca>        selo circular nas cores da marca — ícone pequeno, favicon,
//                  sidebar recolhida.
//   <MarcaOficial> o logo oficial em si — Login e sidebar aberta, sempre sobre
//                  fundo claro.

import React from 'react';
import logoOficial from '../assets/logo-pasto-bom.png';

/** Selo circular: sol nascendo entre as duas colinas do logo. */
export function Marca({
  className = 'h-9 w-9',
}: {
  className?: string;
}): React.ReactElement {
  return (
    <svg
      viewBox="0 0 36 36"
      className={className}
      role="img"
      aria-label="Pasto Bom"
    >
      <circle cx="18" cy="18" r="18" fill="#0F5222" />
      <circle
        cx="18"
        cy="18"
        r="17"
        fill="none"
        stroke="#BDCB3B"
        strokeOpacity="0.35"
      />
      {/* sol */}
      <circle cx="18" cy="17.5" r="6.2" fill="#F2D216" />
      {/* colina clara (limão), à esquerda */}
      <path
        d="M4 22.5 C10 17.5 16 17.8 21.5 21 C15.5 20.2 9.8 21.2 4 24 Z"
        fill="#BDCB3B"
      />
      {/* colina escura (verde da faixa), à direita e por cima */}
      <path
        d="M32 19.5 C25.5 21.2 19.5 24 14 28.5 C21 26.8 27 26.6 32 27.6 Z"
        fill="#176D2E"
      />
      <path
        d="M32 19.5 C25.5 21.2 19.5 24 14 28.5 C20.5 25.2 26.5 22.6 32 21.6 Z"
        fill="#199A3C"
      />
    </svg>
  );
}

/** Logo oficial completo. Usar SOMENTE sobre fundo claro (creme/branco). */
export function MarcaOficial({
  className = 'h-16',
}: {
  className?: string;
}): React.ReactElement {
  return (
    <img
      src={logoOficial}
      alt="Rede do Campo — Pasto Bom"
      className={className}
    />
  );
}
