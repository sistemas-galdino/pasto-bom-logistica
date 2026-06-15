// Marca da Pasto Bom: um broto/folha dentro de um selo circular verde.
// Vetor leve, sem dependências, no tom do agro.

import React from 'react';

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
      <circle cx="18" cy="18" r="18" fill="#1C4E37" />
      <circle cx="18" cy="18" r="17" fill="none" stroke="#E4EFE2" strokeOpacity="0.25" />
      {/* caule */}
      <path
        d="M18 27 C18 22 18 18 18 15"
        stroke="#E4EFE2"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      {/* folha esquerda */}
      <path
        d="M18 19 C14.5 19 11.5 16.7 11 12.8 C14.8 12.4 17.6 14.6 18 18.4 Z"
        fill="#3C7D52"
      />
      {/* folha direita (clara) */}
      <path
        d="M18 16.5 C21 16.2 23.6 14 24 10.6 C20.6 10.3 18.2 12.2 18 15.4 Z"
        fill="#E4EFE2"
      />
    </svg>
  );
}
