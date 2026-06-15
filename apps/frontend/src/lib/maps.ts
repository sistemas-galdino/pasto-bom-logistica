// Fase 3 (RF-3.1): deep link de navegação do Google Maps para a entrega.
// Usa lat/long do destino quando forem coordenadas REAIS; senão cai para o
// endereço em texto. Muitos cadastros vêm sem coords (ou com "-"), por isso a
// validação numérica + fallback. Sem API key e sem mapa embutido.

import type { Pedido } from '@pastobom/shared';

const BASE = 'https://www.google.com/maps/dir/?api=1&destination=';

/** Converte texto em coordenada numérica; null se vazio/"-"/não numérico. */
function coord(v?: string): number | null {
  if (!v) return null;
  const t = v.trim().replace(',', '.');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function linkGoogleMaps(pedido: Pedido): string {
  const d = pedido.destino;
  const lat = coord(d?.latitude);
  const lng = coord(d?.longitude);

  // Coordenadas válidas (e não o placeholder 0,0) -> navegação por ponto.
  if (lat !== null && lng !== null && (lat !== 0 || lng !== 0)) {
    return BASE + encodeURIComponent(`${lat},${lng}`);
  }

  // Fallback: endereço em texto.
  const texto =
    [d?.endereco, d?.cidade, d?.uf].filter(Boolean).join(', ') ||
    pedido.cidadeCliente ||
    pedido.clienteNome ||
    pedido.clienteCodigo;

  return BASE + encodeURIComponent(texto);
}
