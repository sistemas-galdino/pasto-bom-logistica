// O CHIP da rota de cidade no calendário.
//
// "toda terça-feira eu vou para Cabo Verde na parte da manhã... pode pôr até de
// outra cor" (Natália, 27/08). É um AVISO, não uma ocupação: o chip não diz que
// um caminhão está tomado, diz que aquele dia já tem um destino combinado.
//
// A COR É `limao` (#BDCB3B), e a escolha não é estética. Toda cor da paleta já
// carrega significado de status neste calendário — `folha`/`mata` é manhã e
// entrega, `trigo` é tarde e pendência, `terra` é capacidade estourada, `brasa`
// é erro, e o tracejado `pedra` já é "Reserva". `limao` é o único token da
// marca que não é usado em lugar nenhum hoje (conferido), então ele pode
// significar "rota de cidade" sem roubar o significado de ninguém.
//
// A FAIXA DEVOLVE `null` QUANDO VAZIA: quem não usa rota de cidade não ganha
// nem um pixel de altura. E mostra no máximo 2 chips — a coluna da visão de
// Semana tem ~140 px, e três chips empilhados desalinhariam a faixa inteira.

import React from 'react';
import { MapPin } from 'lucide-react';
import type { RotaCidadeNoSlot } from '@pastobom/shared';

/** Acima disto, o resto vira "+N" com a lista no `title`. */
const MAX_CHIPS = 2;

export interface ChipRotaCidadeProps {
  cidade: string;
  /** `compacto` é a coluna da semana; o normal é a visão de Dia. */
  compacto?: boolean;
  title?: string;
}

export function ChipRotaCidade({
  cidade,
  compacto = false,
  title,
}: ChipRotaCidadeProps): React.ReactElement {
  return (
    <span
      title={title ?? `Rota de cidade: ${cidade}`}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border border-limao/50 bg-limao-claro font-semibold text-limao-escuro ${
        compacto ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      }`}
    >
      <MapPin
        className={compacto ? 'h-2.5 w-2.5 shrink-0' : 'h-3.5 w-3.5 shrink-0'}
        aria-hidden="true"
      />
      <span className="truncate">{cidade}</span>
    </span>
  );
}

export interface FaixaRotasCidadeProps {
  /** Ocorrências já filtradas para este slot (ou para este dia). */
  rotas: readonly RotaCidadeNoSlot[];
  compacto?: boolean;
}

export function FaixaRotasCidade({
  rotas,
  compacto = false,
}: FaixaRotasCidadeProps): React.ReactElement | null {
  if (rotas.length === 0) return null;

  const mostrados = rotas.slice(0, MAX_CHIPS);
  const restantes = rotas.slice(MAX_CHIPS);

  return (
    <div
      className={`flex flex-wrap items-center ${compacto ? 'gap-1' : 'gap-1.5'}`}
    >
      {mostrados.map((r) => (
        <ChipRotaCidade
          key={`${r.configId}|${r.cidade}`}
          cidade={r.cidade}
          compacto={compacto}
        />
      ))}
      {restantes.length > 0 && (
        <span
          title={restantes.map((r) => r.cidade).join(', ')}
          className={`rounded-full border border-limao/40 bg-limao-claro font-semibold text-limao-escuro ${
            compacto ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
          }`}
        >
          +{restantes.length}
        </span>
      )}
    </div>
  );
}
