// [AGENTE CLIMA] Previsão do tempo para o dia da entrega via Open-Meteo.
//
// Open-Meteo é gratuito e SEM API KEY. Duas APIs:
//   - geocoding-api.open-meteo.com/v1/search  (cidade -> lat/lon)
//   - api.open-meteo.com/v1/forecast          (lat/lon -> diário, até 16 dias)
//
// Local do clima = destino da entrega (propriedade preferida; senão o cliente),
// mesma regra do toDestino em api/routes/pedidos.ts. Usa lat/lon do cadastro se
// houver; senão geocodifica a cidade. Tudo best-effort: qualquer falha vira
// `disponivel:false` (nunca lança) para não derrubar o board.
//
// Caches em memória: geocoding (vida do processo) e forecast (TTL ~2h), com
// coalescência de chamadas concorrentes ao mesmo local.

import type { PrevisaoClima } from '@pastobom/shared';
import { mapearWmo } from '@pastobom/shared';

import { supabase } from '../db/supabase.js';
import { log } from '../log.js';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 6_000;
const FORECAST_TTL_MS = 2 * 60 * 60 * 1000;
const FORECAST_DIAS = 16;

interface Coord {
  lat: number;
  lon: number;
}

interface ForecastDia {
  tempMax: number | null;
  tempMin: number | null;
  precipitacaoProb: number | null;
  codigoWmo: number | null;
}

interface Destino {
  cidade: string;
  uf: string;
  lat: number | null;
  lon: number | null;
}

// --- Caches -----------------------------------------------------------------

const cacheGeo = new Map<string, Coord | null>();
const geoEmAndamento = new Map<string, Promise<Coord | null>>();

interface ForecastCacheItem {
  buscadoEmMs: number;
  dias: Map<string, ForecastDia>;
}
const cacheForecast = new Map<string, ForecastCacheItem>();
const forecastEmAndamento = new Map<string, Promise<Map<string, ForecastDia> | null>>();

// --- HTTP --------------------------------------------------------------------

/** GET com timeout; devolve o JSON parseado ou null em qualquer falha. */
async function getJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      log.warn(`[clima] HTTP ${resp.status} em ${url}`);
      return null;
    }
    return (await resp.json()) as unknown;
  } catch (err) {
    const motivo =
      err instanceof Error && err.name === 'AbortError'
        ? `timeout ${TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    log.warn(`[clima] falha ao chamar Open-Meteo (${motivo})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- Geocoding ---------------------------------------------------------------

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Converte uma cidade (BR) em coordenadas via Open-Meteo geocoding. Cacheado
 * por "cidade|uf" durante a vida do processo (cidades não se movem).
 */
export async function geocodificarCidade(
  cidade: string,
  uf: string,
): Promise<Coord | null> {
  const cidadeLimpa = (cidade ?? '').trim();
  if (!cidadeLimpa) return null;

  const chave = `${norm(cidadeLimpa)}|${norm(uf ?? '')}`;
  if (cacheGeo.has(chave)) return cacheGeo.get(chave) ?? null;
  const emAndamento = geoEmAndamento.get(chave);
  if (emAndamento) return emAndamento;

  const promessa = (async (): Promise<Coord | null> => {
    const url =
      `${GEO_URL}?name=${encodeURIComponent(cidadeLimpa)}` +
      `&count=1&language=pt&format=json&country=BR`;
    const json = (await getJson(url)) as
      | { results?: Array<{ latitude?: number; longitude?: number }> }
      | null;
    const r = json?.results?.[0];
    const coord =
      r && typeof r.latitude === 'number' && typeof r.longitude === 'number'
        ? { lat: r.latitude, lon: r.longitude }
        : null;
    cacheGeo.set(chave, coord);
    return coord;
  })();

  geoEmAndamento.set(chave, promessa);
  try {
    return await promessa;
  } finally {
    geoEmAndamento.delete(chave);
  }
}

// --- Forecast ----------------------------------------------------------------

/** Coordenada válida? (finita, dentro de faixa e não 0,0). */
function coordValida(lat: number | null, lon: number | null): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

const chaveForecast = (c: Coord): string =>
  `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;

/**
 * Busca a previsão diária (até 16 dias) para um par lat/lon e devolve um mapa
 * data ISO -> dia. Cacheado por local (TTL ~2h) com coalescência de chamadas.
 */
async function obterForecast(
  coord: Coord,
): Promise<Map<string, ForecastDia> | null> {
  const chave = chaveForecast(coord);
  const cache = cacheForecast.get(chave);
  if (cache && Date.now() - cache.buscadoEmMs < FORECAST_TTL_MS) {
    return cache.dias;
  }
  const emAndamento = forecastEmAndamento.get(chave);
  if (emAndamento) return emAndamento;

  const promessa = (async (): Promise<Map<string, ForecastDia> | null> => {
    const url =
      `${FORECAST_URL}?latitude=${coord.lat}&longitude=${coord.lon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=auto&forecast_days=${FORECAST_DIAS}`;
    const json = (await getJson(url)) as
      | {
          daily?: {
            time?: string[];
            weather_code?: number[];
            temperature_2m_max?: number[];
            temperature_2m_min?: number[];
            precipitation_probability_max?: Array<number | null>;
          };
        }
      | null;

    const d = json?.daily;
    if (!d?.time) return null;

    const dias = new Map<string, ForecastDia>();
    d.time.forEach((data, i) => {
      dias.set(data, {
        tempMax: d.temperature_2m_max?.[i] ?? null,
        tempMin: d.temperature_2m_min?.[i] ?? null,
        precipitacaoProb: d.precipitation_probability_max?.[i] ?? null,
        codigoWmo: d.weather_code?.[i] ?? null,
      });
    });
    cacheForecast.set(chave, { buscadoEmMs: Date.now(), dias });
    return dias;
  })();

  forecastEmAndamento.set(chave, promessa);
  try {
    return await promessa;
  } finally {
    forecastEmAndamento.delete(chave);
  }
}

// --- Montagem do DTO ---------------------------------------------------------

function indisponivel(
  cidade: string,
  uf: string,
  data: string,
  motivo: PrevisaoClima['motivo'],
): PrevisaoClima {
  return {
    data,
    cidade,
    uf,
    disponivel: false,
    motivo,
    tempMax: null,
    tempMin: null,
    precipitacaoProb: null,
    codigoWmo: null,
    descricao: '',
    icone: 'desconhecido',
  };
}

/**
 * Resolve a previsão para uma cidade/coord em uma data. coords > geocoding >
 * sem_localizacao. Nunca lança: erro de rede vira motivo 'erro'.
 */
export async function resolverClima(input: {
  cidade: string;
  uf: string;
  lat: number | null;
  lon: number | null;
  dataISO: string;
}): Promise<PrevisaoClima> {
  const { cidade, uf, dataISO } = input;
  try {
    let coord: Coord | null = coordValida(input.lat, input.lon)
      ? { lat: input.lat, lon: input.lon as number }
      : null;
    if (!coord) coord = await geocodificarCidade(cidade, uf);
    if (!coord) return indisponivel(cidade, uf, dataISO, 'sem_localizacao');

    const dias = await obterForecast(coord);
    if (!dias) return indisponivel(cidade, uf, dataISO, 'erro');

    const dia = dias.get(dataISO);
    if (!dia || dia.codigoWmo === null) {
      return indisponivel(cidade, uf, dataISO, 'fora_do_horizonte');
    }

    const { descricao, icone } = mapearWmo(dia.codigoWmo);
    return {
      data: dataISO,
      cidade,
      uf,
      disponivel: true,
      tempMax: dia.tempMax,
      tempMin: dia.tempMin,
      precipitacaoProb: dia.precipitacaoProb,
      codigoWmo: dia.codigoWmo,
      descricao,
      icone,
    };
  } catch (err) {
    log.warn(
      `[clima] erro inesperado em resolverClima: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return indisponivel(cidade, uf, dataISO, 'erro');
  }
}

// --- Resolução do destino (Supabase) ----------------------------------------

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

interface PedidoLocal {
  cliente_codigo: string | null;
  propriedade_codigo: string | null;
  cidade_cliente: string | null;
  data_agendada: string | null;
}

/** Busca cidade/uf/coords de uma propriedade. */
async function destinoPropriedade(codigo: string): Promise<Destino | null> {
  const { data } = await supabase
    .from('propriedades')
    .select('cidade, uf, latitude, longitude')
    .eq('codigo', codigo)
    .maybeSingle();
  if (!data) return null;
  return {
    cidade: (data.cidade as string) ?? '',
    uf: (data.uf as string) ?? '',
    lat: num(data.latitude),
    lon: num(data.longitude),
  };
}

/** Busca cidade/uf/coords de um cliente. */
async function destinoCliente(codigo: string): Promise<Destino | null> {
  const { data } = await supabase
    .from('clientes')
    .select('cidade, uf, latitude, longitude')
    .eq('codigo', codigo)
    .maybeSingle();
  if (!data) return null;
  return {
    cidade: (data.cidade as string) ?? '',
    uf: (data.uf as string) ?? '',
    lat: num(data.latitude),
    lon: num(data.longitude),
  };
}

/**
 * Clima de UM pedido. `dataOverride` (data escolhida no modal, ainda não salva)
 * e `propriedadeOverride` (propriedade selecionada) têm prioridade sobre os
 * valores armazenados. Sem data → não há o que prever.
 */
export async function climaDoPedido(
  pedidoId: string,
  dataOverride?: string,
  propriedadeOverride?: string,
): Promise<PrevisaoClima> {
  const { data: row } = await supabase
    .from('pedidos')
    .select('cliente_codigo, propriedade_codigo, cidade_cliente, data_agendada')
    .eq('id', pedidoId)
    .maybeSingle<PedidoLocal>();

  const dataISO = (dataOverride || row?.data_agendada || '').slice(0, 10);
  const cidadeFallback = row?.cidade_cliente ?? '';
  if (!dataISO) return indisponivel(cidadeFallback, '', '', 'fora_do_horizonte');
  if (!row) return indisponivel(cidadeFallback, '', dataISO, 'sem_localizacao');

  const propCodigo = propriedadeOverride || row.propriedade_codigo || '';
  let destino: Destino | null = propCodigo
    ? await destinoPropriedade(propCodigo)
    : null;
  if (!destino && row.cliente_codigo) {
    destino = await destinoCliente(row.cliente_codigo);
  }

  const cidade = destino?.cidade || cidadeFallback;
  const uf = destino?.uf ?? '';
  if (!cidade && !coordValida(destino?.lat ?? null, destino?.lon ?? null)) {
    return indisponivel(cidade, uf, dataISO, 'sem_localizacao');
  }

  return resolverClima({
    cidade,
    uf,
    lat: destino?.lat ?? null,
    lon: destino?.lon ?? null,
    dataISO,
  });
}

/**
 * Clima de VÁRIOS pedidos (board/rota), usando a data e o destino ARMAZENADOS.
 * Uma query por tabela (sem N+1); o cache de forecast colapsa locais repetidos.
 */
export async function climaLote(
  pedidoIds: string[],
): Promise<Record<string, PrevisaoClima | null>> {
  const ids = [...new Set(pedidoIds.filter((s) => s && s.length > 0))];
  const resultado: Record<string, PrevisaoClima | null> = {};
  if (ids.length === 0) return resultado;

  const { data: linhas } = await supabase
    .from('pedidos')
    .select('id, cliente_codigo, propriedade_codigo, cidade_cliente, data_agendada')
    .in('id', ids);

  const rows = (linhas ?? []) as Array<PedidoLocal & { id: string }>;

  const propCods = [
    ...new Set(rows.map((r) => r.propriedade_codigo).filter((v): v is string => !!v)),
  ];
  const cliCods = [
    ...new Set(rows.map((r) => r.cliente_codigo).filter((v): v is string => !!v)),
  ];

  const props = new Map<string, Destino>();
  if (propCods.length > 0) {
    const { data } = await supabase
      .from('propriedades')
      .select('codigo, cidade, uf, latitude, longitude')
      .in('codigo', propCods);
    for (const r of data ?? [])
      props.set(r.codigo as string, {
        cidade: (r.cidade as string) ?? '',
        uf: (r.uf as string) ?? '',
        lat: num(r.latitude),
        lon: num(r.longitude),
      });
  }

  const clis = new Map<string, Destino>();
  if (cliCods.length > 0) {
    const { data } = await supabase
      .from('clientes')
      .select('codigo, cidade, uf, latitude, longitude')
      .in('codigo', cliCods);
    for (const r of data ?? [])
      clis.set(r.codigo as string, {
        cidade: (r.cidade as string) ?? '',
        uf: (r.uf as string) ?? '',
        lat: num(r.latitude),
        lon: num(r.longitude),
      });
  }

  await Promise.all(
    rows.map(async (row) => {
      const dataISO = (row.data_agendada ?? '').slice(0, 10);
      if (!dataISO) {
        resultado[row.id] = null;
        return;
      }
      const destino =
        (row.propriedade_codigo ? props.get(row.propriedade_codigo) : undefined) ??
        (row.cliente_codigo ? clis.get(row.cliente_codigo) : undefined) ??
        null;
      const cidade = destino?.cidade || row.cidade_cliente || '';
      const uf = destino?.uf ?? '';
      if (!cidade && !coordValida(destino?.lat ?? null, destino?.lon ?? null)) {
        resultado[row.id] = indisponivel(cidade, uf, dataISO, 'sem_localizacao');
        return;
      }
      resultado[row.id] = await resolverClima({
        cidade,
        uf,
        lat: destino?.lat ?? null,
        lon: destino?.lon ?? null,
        dataISO,
      });
    }),
  );

  // ids sem linha no banco -> null explícito
  for (const id of ids) if (!(id in resultado)) resultado[id] = null;

  return resultado;
}
