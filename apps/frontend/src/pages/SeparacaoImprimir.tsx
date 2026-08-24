// Lista de separação em papel — pedido da Natália por áudio (08/2026).
//
// "Coloca pra gente lá aonde tem o menu de separação (...) uma flagzinha para a
//  gente conseguir baixar essa lista de separação em pdf (...) porque a gente
//  ainda não automatizou todo mundo eletrônico, então se o Johnny sentir
//  necessidade de baixar aquele pedido em pdf para o pessoal separar (...)"
//
// A regra dura dela: "que não misture um pedido de um caminhão para o outro".
// Daí UMA FOLHA POR VIAGEM: a folha não tem como conter carga de dois
// caminhões, e o Johnny pode entregar uma folha para cada pessoa do galpão. O
// formato ela deixou a nosso critério ("da maneira mais fácil que você achar").
//
// POR QUE window.print() E NÃO UMA BIBLIOTECA DE PDF
// ---------------------------------------------------------------------------
// jspdf/pdfmake custariam ~350-400 KB no bundle, posicionamento manual de cada
// text(x, y) — nada de reaproveitar componente — e paginação por aritmética. Em
// troca dariam só o nome do arquivo automático. O diálogo de impressão do
// navegador já tem "Salvar como PDF", e o destino real disto é a IMPRESSORA do
// galpão, não um arquivo.
//
// A tela fica FORA do AppShell (ver App.tsx): sem sidebar e sem topbar não há
// nada a esconder na impressão, e ela abre em aba nova sem perder o filtro da
// tela de separação.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Printer, X } from 'lucide-react';
import type { Entrega, PeriodoEntrega } from '@pastobom/shared';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';

const SEM_CAMINHAO = 'Sem caminhão';

const PERIODO_ROTULO: Record<PeriodoEntrega, string> = {
  manha: 'MANHÃ',
  tarde: 'TARDE',
};

// --- datas (sempre locais; nunca `new Date('YYYY-MM-DD')`) -----------------

function isoDeData(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function hojeLocal(): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

function dataLonga(iso: string): string {
  const p = iso.split('-').map(Number);
  const ano = p[0];
  const mes = p[1];
  const dia = p[2];
  if (ano === undefined || mes === undefined || dia === undefined) return iso;
  return new Date(ano, mes - 1, dia).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatarQtd(qtd: number): string {
  return qtd.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function emToneladas(kg: number): string {
  return (kg / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Caminhão da viagem, com o mesmo rótulo da tela de separação. */
function caminhaoDe(e: Entrega): string {
  return e.caminhaoNome || SEM_CAMINHAO;
}

/**
 * Ordena as viagens do papel: caminhão, período, cliente, nº da OV.
 *
 * Mesmo critério da agenda (ver agenda-grupos.ts em @pastobom/shared), aqui
 * sobre `Entrega[]` em vez de `AgendaEntrega[]`. "Sem caminhão" no fim, para a
 * pendência não abrir o maço.
 */
function ordenar(entregas: Entrega[]): Entrega[] {
  const ordemPeriodo: Record<string, number> = { manha: 0, tarde: 1 };
  return [...entregas].sort((a, b) => {
    const ca = caminhaoDe(a);
    const cb = caminhaoDe(b);
    if (ca !== cb) {
      if (ca === SEM_CAMINHAO) return 1;
      if (cb === SEM_CAMINHAO) return -1;
      const porCaminhao = ca.localeCompare(cb, 'pt-BR');
      if (porCaminhao !== 0) return porCaminhao;
    }
    const pa = ordemPeriodo[a.periodo ?? ''] ?? 9;
    const pb = ordemPeriodo[b.periodo ?? ''] ?? 9;
    if (pa !== pb) return pa - pb;
    const porCliente = a.clienteNome.localeCompare(b.clienteNome, 'pt-BR', {
      sensitivity: 'base',
    });
    if (porCliente !== 0) return porCliente;
    return a.orixNumero.localeCompare(b.orixNumero, 'pt-BR', { numeric: true });
  });
}

export default function SeparacaoImprimir(): React.ReactElement {
  const [params] = useSearchParams();
  const { papel } = useAuth();
  const podeSeparar = papel === 'logistica' || papel === 'almoxarifado';

  const modo = params.get('modo') === 'atrasados' ? 'atrasados' : 'dia';
  const dia = params.get('dia') ?? isoDeData(hojeLocal());
  const caminhaoFiltro = params.get('caminhao');

  // MESMA queryKey da tela de Separação: abre com o cache quente de quem
  // clicou no botão.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['entregas', 'separacao'],
    queryFn: ({ signal }) =>
      api.listarEntregas({ status: ['agendada'] }, signal),
    enabled: podeSeparar,
  });

  const isoHoje = isoDeData(hojeLocal());

  const viagens = React.useMemo(() => {
    const todas = data ?? [];
    const daSelecao =
      modo === 'atrasados'
        ? todas.filter((e) => e.dataAgendada < isoHoje)
        : todas.filter((e) => e.dataAgendada === dia);
    const filtradas =
      caminhaoFiltro === null
        ? daSelecao
        : daSelecao.filter((e) => caminhaoDe(e) === caminhaoFiltro);
    return ordenar(filtradas);
  }, [data, modo, dia, isoHoje, caminhaoFiltro]);

  const titulo =
    modo === 'atrasados' ? 'ATRASADOS' : dataLonga(dia).toUpperCase();

  if (!podeSeparar) {
    return (
      <div className="p-8">
        <p className="text-sm text-tinta-suave">
          Esta lista é da logística e do almoxarifado.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[820px] p-6 print:p-0">
      {/* Barra de controle: some na impressão. */}
      <div className="nao-imprimir mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-linha bg-papel p-3">
        <div className="text-sm text-tinta-suave">
          <strong className="font-semibold text-mata-escuro">
            Lista de separação
          </strong>{' '}
          · {titulo}
          {caminhaoFiltro ? ` · ${caminhaoFiltro}` : ''} ·{' '}
          {viagens.length === 1 ? '1 folha' : `${viagens.length} folhas`}
        </div>
        <div className="flex items-center gap-2">
          {/* Manual de propósito: window.print() num useEffect dispara antes de
              os dados chegarem e imprime folha vazia. */}
          <button
            type="button"
            onClick={() => window.print()}
            disabled={viagens.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-mata px-3 py-1.5 text-xs font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            Imprimir / Salvar como PDF
          </button>
          <button
            type="button"
            onClick={() => window.close()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-linha px-3 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Fechar
          </button>
        </div>
      </div>

      {isLoading && (
        <p className="nao-imprimir text-sm text-tinta-suave">Carregando…</p>
      )}
      {isError && (
        <p className="nao-imprimir text-sm text-brasa-escuro">
          {error instanceof Error ? error.message : 'Falha ao carregar.'}
        </p>
      )}
      {!isLoading && !isError && viagens.length === 0 && (
        <p className="nao-imprimir text-sm text-tinta-suave">
          Nada a separar nesta seleção.
        </p>
      )}

      {viagens.map((e, i) => (
        <Folha
          key={e.id}
          entrega={e}
          numero={i + 1}
          total={viagens.length}
          titulo={titulo}
        />
      ))}
    </div>
  );
}

interface FolhaProps {
  entrega: Entrega;
  numero: number;
  total: number;
  titulo: string;
}

/**
 * Uma folha A4 — uma viagem.
 *
 * Tudo em preto no branco e com fonte grande: isto vai para uma prancheta em
 * galpão, com luz ruim. A quantidade vem antes do nome e em corpo maior porque
 * é o que o separador lê primeiro.
 */
function Folha({
  entrega,
  numero,
  total,
  titulo,
}: FolhaProps): React.ReactElement {
  const local = [entrega.bairro, entrega.cidadeCliente]
    .filter((p) => p && p.trim().length > 0)
    .join(' · ');

  return (
    <section className="folha mb-8 border border-tinta/30 p-5 text-tinta print:mb-0 print:border-0 print:p-0">
      <header className="flex items-baseline justify-between gap-3 border-b-2 border-tinta pb-1.5">
        <h1 className="text-[15px] font-bold uppercase tracking-wide">
          Pasto Bom — Lista de separação
        </h1>
        <span className="text-[13px] font-bold">
          {titulo}
          {entrega.periodo ? ` · ${PERIODO_ROTULO[entrega.periodo]}` : ''}
        </span>
      </header>

      <dl className="mt-2 grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="font-bold uppercase">Caminhão</dt>
        {/* Sem a placa: `Entrega` não a carrega, e buscá-la exigiria mexer no
            backend por um detalhe que o galpão não usa — lá o caminhão é
            chamado pelo nome. */}
        <dd>{entrega.caminhaoNome || '—'}</dd>
        <dt className="font-bold uppercase">Motorista</dt>
        <dd>{entrega.motoristaNome || '—'}</dd>

        <dt className="font-bold uppercase">Cliente</dt>
        <dd className="font-semibold">{entrega.clienteNome || '—'}</dd>
        <dt className="font-bold uppercase">Pedido nº</dt>
        <dd className="font-semibold">{entrega.orixNumero || '—'}</dd>

        <dt className="font-bold uppercase">Local</dt>
        <dd className="col-span-3">{local || '—'}</dd>
      </dl>

      <table className="mt-3 w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-y-2 border-tinta text-left">
            <th className="w-[70px] py-1 text-right font-bold uppercase">
              Quant.
            </th>
            <th className="py-1 pl-3 font-bold uppercase">Produto</th>
            <th className="w-[90px] py-1 text-center font-bold uppercase">
              Conferido
            </th>
          </tr>
        </thead>
        <tbody>
          {entrega.itens.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-3 text-center">
                Esta viagem não tem itens.
              </td>
            </tr>
          ) : (
            entrega.itens.map((item) => (
              <tr key={item.id} className="border-b border-tinta/30">
                <td className="py-1.5 text-right align-top text-[16px] font-bold">
                  {formatarQtd(item.qtd)}
                </td>
                <td className="break-words py-1.5 pl-3 align-top">
                  {item.nomeProduto || item.produtoCodigo}
                </td>
                {/* Quadradinho para marcar à mão: é assim que o galpão trabalha
                    hoje, e é por isso que esta folha existe. */}
                <td className="py-1.5 text-center align-top">
                  <span className="inline-block h-4 w-4 border border-tinta" />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <p className="mt-2 text-[13px]">
        <strong>Total:</strong>{' '}
        {entrega.pesoTotalKg === null
          ? 'peso pendente'
          : `${emToneladas(entrega.pesoTotalKg)} t`}{' '}
        ·{' '}
        {entrega.itens.length === 1
          ? '1 item'
          : `${entrega.itens.length} itens`}
      </p>

      <footer className="mt-5 flex items-end justify-between gap-4 text-[12px]">
        <span className="flex-1">
          Separado por: <span className="inline-block w-40 border-b border-tinta" />
        </span>
        <span>
          Hora: <span className="inline-block w-16 border-b border-tinta" />
        </span>
        <span>
          Conferido: <span className="inline-block w-20 border-b border-tinta" />
        </span>
        <span className="whitespace-nowrap text-tinta/70">
          folha {numero} de {total}
        </span>
      </footer>
    </section>
  );
}
