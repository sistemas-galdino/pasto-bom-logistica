// O botão que abre o cadastro de rotas de cidade, com o modal junto.
//
// Existe como componente porque as DUAS telas de calendário precisam dele na
// mesma rodada em que o painel da agenda mudou de lugar — e um botão + estado +
// modal copiado em duas páginas é a forma mais barata de as duas divergirem.
// Cada página usa numa linha só.
//
// SÓ A LOGÍSTICA VÊ. Para os outros papéis ele devolve `null`, e não um botão
// desabilitado: a /agenda é a tela de leitura de todo mundo, e um botão morto
// ali convidaria o vendedor a pedir acesso a uma coisa que não é dele. O
// backend recusa a escrita de qualquer jeito; a tela só não oferece.

import React, { useState } from 'react';
import { MapPin } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { RotasCidadeModal } from '../RotasCidadeModal';

export interface AcaoRotasCidadeProps {
  /** Cidades vistas no calendário aberto, para o autocomplete do formulário. */
  cidadesSugeridas?: readonly string[];
  /**
   * Classe de um invólucro opcional (ex.: "flex justify-end").
   *
   * Ele vem DAQUI, e não da página, porque quando o componente devolve `null`
   * o invólucro tem de sumir junto: um `<div>` vazio deixado pela página ainda
   * ganha a margem do `space-y-4` do pai, e o vendedor veria 16 px de vão no
   * lugar de um botão que ele nem pode ver.
   */
  className?: string;
}

export function AcaoRotasCidade({
  cidadesSugeridas = [],
  className,
}: AcaoRotasCidadeProps): React.ReactElement | null {
  const { podeEscrever } = useAuth();
  const [aberto, setAberto] = useState(false);

  if (!podeEscrever) return null;

  const Envolucro = className === undefined ? React.Fragment : 'div';
  const props = className === undefined ? {} : { className };

  return (
    <Envolucro {...props}>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex items-center gap-1.5 rounded-full border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-limao hover:text-limao-escuro"
      >
        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
        Rotas de cidade
      </button>

      {aberto && (
        <RotasCidadeModal
          cidadesSugeridas={cidadesSugeridas}
          onFechar={() => setAberto(false)}
        />
      )}
    </Envolucro>
  );
}
