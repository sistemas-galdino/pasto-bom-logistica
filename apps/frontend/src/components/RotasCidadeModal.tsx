// ROTAS DE CIDADE — cadastro de "toda terça e quinta, Cabo Verde, de manhã".
//
// No molde do LimitesEntregaModal (lista + formulário + remoção confirmada na
// própria linha), porque é a mesma forma de configuração datada e a Natália
// pediu apontando para aquela tela: "pode ser dessa forma aqui mesmo, a mesma
// regra".
//
// O AVISO NO TOPO NÃO É DECORAÇÃO. "Rota" é uma palavra carregada neste
// sistema — existe a tela de Rota, a rota do motorista, a ordem das paradas. A
// pessoa que cadastra precisa saber, antes de clicar, que ISTO não reserva
// caminhão nem ocupa o dia. Sem a frase, o primeiro que cadastrar "Cabo Verde,
// terça" vai esperar que a terça apareça ocupada.
//
// PAUSAR EM VEZ DE APAGAR é o caminho normal: a rota de safra volta no ano que
// vem, e apagar obriga a redigitar dias, períodos e vigência. Apagar continua
// existindo para quem errou o cadastro.
//
// MUDAR DIA, PERÍODO OU VIGÊNCIA NÃO SE EDITA: é rota nova. Configuração datada
// não se reescreve — quem trocasse "terça" por "quinta" apagaria o registro de
// que, até ontem, às terças o caminhão ia para Cabo Verde. O backend recusa o
// PATCH desses campos; aqui a tela nem os oferece.

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MapPin, Pause, Play, Trash2, X } from 'lucide-react';
import type { PeriodoEntrega, RotaCidade } from '@pastobom/shared';
import { chaveCidade } from '@pastobom/shared';
import { api, ApiError } from '../lib/api';
import { formatarData } from '../lib/format';
import { DIAS_CURTOS } from '../lib/datas';

interface Props {
  /**
   * Cidades já vistas na janela aberta do calendário, para o `<datalist>`.
   *
   * Sem endpoint novo: a agenda já devolve a cidade de cada entrega, e as rotas
   * cadastradas trazem as demais. `GET /api/cidades` fica recusado por ora — a
   * fonte seria o espelho do Órix, que JÁ tem as três grafias misturadas, e
   * alimentar o formulário com ele propagaria para dentro da configuração
   * exatamente a inconsistência que a chave de cidade existe para absorver.
   */
  cidadesSugeridas?: readonly string[];
  onFechar: () => void;
}

const PERIODOS: readonly PeriodoEntrega[] = ['manha', 'tarde'];
const PERIODO_ROTULO: Record<PeriodoEntrega, string> = {
  manha: 'Manhã',
  tarde: 'Tarde',
};

function mensagemDeErro(err: unknown, fallback: string): string {
  // O 409 de rota duplicada já vem com a frase que ensina o caminho.
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

/** 'YYYY-MM-DD' de hoje em horário LOCAL — nunca via toISOString (fuso). */
function hojeISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** "Ter, Qui" — rótulos do DIAS_CURTOS, sem inventar um segundo vocabulário. */
function rotuloDias(dias: readonly number[]): string {
  const ordenados = [...dias].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (ordenados.length === 7) return 'Todo dia';
  return ordenados.map((d) => DIAS_CURTOS[d]).join(', ');
}

function rotuloPeriodos(periodos: readonly PeriodoEntrega[]): string {
  if (periodos.length === 2) return 'dia inteiro';
  return periodos.map((p) => PERIODO_ROTULO[p].toLowerCase()).join(' e ');
}

function rotuloVigencia(rota: RotaCidade): string {
  const inicio = formatarData(rota.validoDe);
  if (rota.validoAte === null) return `${inicio} em diante`;
  return `${inicio} – ${formatarData(rota.validoAte)}`;
}

export function RotasCidadeModal({
  cidadesSugeridas = [],
  onFechar,
}: Props): React.ReactElement {
  const queryClient = useQueryClient();

  const [cidade, setCidade] = useState('');
  const [dias, setDias] = useState<Set<number>>(new Set());
  const [periodos, setPeriodos] = useState<Set<PeriodoEntrega>>(
    () => new Set<PeriodoEntrega>(['manha']),
  );
  const [validoDe, setValidoDe] = useState(hojeISO());
  const [validoAte, setValidoAte] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState<string | null>(
    null,
  );

  const rotasQuery = useQuery({
    queryKey: ['rotas-cidade'],
    queryFn: ({ signal }) => api.listarRotasCidade(signal),
  });

  function invalidar() {
    void queryClient.invalidateQueries({ queryKey: ['rotas-cidade'] });
    // E a AGENDA, por prefixo. Sem isto o chip só aparece depois de um F5; e
    // invalidar só a janela aberta deixaria as outras semanas com chip velho.
    void queryClient.invalidateQueries({ queryKey: ['agenda'] });
  }

  const criar = useMutation({
    mutationFn: (body: Parameters<typeof api.criarRotaCidade>[0]) =>
      api.criarRotaCidade(body),
    onSuccess: () => {
      setCidade('');
      setDias(new Set());
      setObservacoes('');
      setErroForm(null);
      invalidar();
    },
  });

  const alternarAtivo = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.atualizarRotaCidade(id, { ativo }),
    onSuccess: invalidar,
  });

  const remover = useMutation({
    mutationFn: (id: string) => api.removerRotaCidade(id),
    onSuccess: () => {
      setConfirmandoRemocao(null);
      invalidar();
    },
  });

  const rotas = rotasQuery.data ?? [];

  /** União das cidades já cadastradas e das vistas no calendário aberto. */
  const sugestoes = useMemo(() => {
    const porChave = new Map<string, string>();
    for (const c of [...rotas.map((r) => r.cidade), ...cidadesSugeridas]) {
      const chave = chaveCidade(c);
      if (chave !== '' && !porChave.has(chave)) porChave.set(chave, c.trim());
    }
    return [...porChave.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [rotas, cidadesSugeridas]);

  const enviando = criar.isPending;
  const erroCriar = criar.isError
    ? mensagemDeErro(criar.error, 'Falha ao cadastrar a rota.')
    : null;
  const erroRemover = remover.isError
    ? mensagemDeErro(remover.error, 'Falha ao remover a rota.')
    : null;

  function alternarDia(d: number): void {
    setDias((atual) => {
      const novo = new Set(atual);
      if (novo.has(d)) novo.delete(d);
      else novo.add(d);
      return novo;
    });
  }

  function alternarPeriodo(p: PeriodoEntrega): void {
    setPeriodos((atual) => {
      const novo = new Set(atual);
      if (novo.has(p)) novo.delete(p);
      else novo.add(p);
      return novo;
    });
  }

  function aoSubmeter(e: React.FormEvent): void {
    e.preventDefault();
    if (enviando) return;

    if (cidade.trim().length === 0) {
      setErroForm('Informe a cidade.');
      return;
    }
    if (dias.size === 0) {
      setErroForm('Escolha ao menos um dia da semana.');
      return;
    }
    if (periodos.size === 0) {
      setErroForm('Escolha ao menos um período.');
      return;
    }
    if (validoDe.length === 0) {
      setErroForm('Informe a data inicial da vigência.');
      return;
    }
    if (validoAte.length > 0 && validoAte < validoDe) {
      setErroForm('A data final não pode ser anterior à inicial.');
      return;
    }
    setErroForm(null);

    const obs = observacoes.trim();
    criar.mutate({
      cidade: cidade.trim(),
      diasSemana: [...dias].sort((a, b) => a - b),
      periodos: PERIODOS.filter((p) => periodos.has(p)),
      validoDe,
      validoAte: validoAte.length > 0 ? validoAte : null,
      ...(obs.length > 0 ? { observacoes: obs } : {}),
    });
  }

  const inputCls =
    'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition placeholder:text-pedra focus:border-folha focus:bg-papel focus:ring-2 focus:ring-folha/25';
  const rotuloCls =
    'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave';
  const caixaCls = (ativo: boolean) =>
    `rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
      ativo
        ? 'border-limao bg-limao-claro text-limao-escuro'
        : 'border-linha bg-papel text-tinta-suave hover:border-limao/40'
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Rotas de cidade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onFechar();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg animate-sobe overflow-y-auto scroll-suave rounded-xl2 bg-papel p-5 shadow-flutua">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-limao-claro text-limao-escuro">
              <MapPin className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold text-mata-escuro">
                Rotas de cidade
              </h2>
              <p className="text-sm text-tinta-suave">
                &ldquo;Toda terça e quinta eu vou para Cabo Verde de manhã.&rdquo;
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={enviando}
            aria-label="Fechar"
            className="rounded-lg p-1 text-tinta-suave transition hover:bg-creme-50 hover:text-tinta disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* O aviso honesto, antes de qualquer campo. */}
        <p className="mb-4 rounded-lg border border-limao/40 bg-limao-claro/60 px-3 py-2 text-xs text-tinta-suave">
          A rota é um <strong className="font-semibold">aviso no calendário</strong>.
          Ela não reserva caminhão, não ocupa o dia e não impede agendar outra
          cidade nesse período — serve para quem olha a agenda saber que aquele
          dia já tem destino combinado.
        </p>

        {/* --- lista --------------------------------------------------------- */}
        <div className="mb-5">
          <h3 className={rotuloCls}>Cadastradas</h3>
          {rotasQuery.isLoading ? (
            <p className="text-sm text-tinta-suave">Carregando…</p>
          ) : rotas.length === 0 ? (
            <p className="rounded-lg border border-dashed border-linha bg-creme-50/60 px-3 py-3 text-sm text-tinta-suave">
              Nenhuma rota de cidade cadastrada.
            </p>
          ) : (
            <ul className="space-y-2">
              {rotas.map((rota) => (
                <li
                  key={rota.id}
                  className={`rounded-lg border px-3 py-2 ${
                    rota.ativo
                      ? 'border-linha bg-creme-50/60'
                      : 'border-dashed border-pedra bg-creme-50/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className={`font-display text-sm font-semibold ${
                          rota.ativo ? 'text-tinta' : 'text-pedra'
                        }`}
                      >
                        {rota.cidade}
                        {!rota.ativo && (
                          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-pedra">
                            pausada
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-tinta-suave">
                        {rotuloDias(rota.diasSemana)} ·{' '}
                        {rotuloPeriodos(rota.periodos)} · {rotuloVigencia(rota)}
                      </p>
                      {rota.observacoes && (
                        <p className="mt-0.5 text-xs text-pedra">
                          {rota.observacoes}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          alternarAtivo.mutate({ id: rota.id, ativo: !rota.ativo })
                        }
                        disabled={alternarAtivo.isPending}
                        title={
                          rota.ativo
                            ? 'Pausar (some do calendário, continua cadastrada)'
                            : 'Religar'
                        }
                        aria-label={rota.ativo ? 'Pausar rota' : 'Religar rota'}
                        className="rounded p-1 text-tinta-suave transition hover:bg-papel hover:text-mata disabled:opacity-50"
                      >
                        {rota.ativo ? (
                          <Pause className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmandoRemocao(rota.id)}
                        disabled={remover.isPending}
                        title="Apagar de vez"
                        aria-label="Apagar rota"
                        className="rounded p-1 text-tinta-suave transition hover:bg-terra-claro hover:text-terra-escuro disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Confirmação na própria linha: um segundo modal por cima
                      deste esconderia justamente a rota que se vai apagar. */}
                  {confirmandoRemocao === rota.id && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-terra/30 bg-terra-claro px-2.5 py-1.5 text-xs text-terra-escuro">
                      <span>
                        Apagar de vez? Para só tirar do calendário, use pausar.
                      </span>
                      <span className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          onClick={() => remover.mutate(rota.id)}
                          disabled={remover.isPending}
                          className="rounded border border-terra/40 bg-papel px-2 py-0.5 font-semibold text-terra-escuro disabled:opacity-50"
                        >
                          Apagar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmandoRemocao(null)}
                          className="rounded px-2 py-0.5 font-semibold text-tinta-suave"
                        >
                          Cancelar
                        </button>
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {erroRemover && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-terra-escuro">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {erroRemover}
            </p>
          )}
        </div>

        {/* --- formulário ---------------------------------------------------- */}
        <form onSubmit={aoSubmeter} className="space-y-3 border-t border-linha pt-4">
          <h3 className={rotuloCls}>Nova rota</h3>

          <div>
            <label htmlFor="rota-cidade" className={rotuloCls}>
              Cidade
            </label>
            <input
              id="rota-cidade"
              list="rota-cidade-sugestoes"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              placeholder="Cabo Verde"
              className={inputCls}
            />
            <datalist id="rota-cidade-sugestoes">
              {sugestoes.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div>
            <span className={rotuloCls}>Dias da semana</span>
            <div className="flex flex-wrap gap-1.5">
              {DIAS_CURTOS.map((rotulo, indice) => (
                <button
                  key={rotulo}
                  type="button"
                  onClick={() => alternarDia(indice)}
                  aria-pressed={dias.has(indice)}
                  className={caixaCls(dias.has(indice))}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={rotuloCls}>Período</span>
            <div className="flex gap-1.5">
              {PERIODOS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => alternarPeriodo(p)}
                  aria-pressed={periodos.has(p)}
                  className={caixaCls(periodos.has(p))}
                >
                  {PERIODO_ROTULO[p]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rota-de" className={rotuloCls}>
                A partir de
              </label>
              <input
                id="rota-de"
                type="date"
                value={validoDe}
                onChange={(e) => setValidoDe(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="rota-ate" className={rotuloCls}>
                Até (opcional)
              </label>
              <input
                id="rota-ate"
                type="date"
                value={validoAte}
                onChange={(e) => setValidoAte(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label htmlFor="rota-obs" className={rotuloCls}>
              Observação (opcional)
            </label>
            <input
              id="rota-obs"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Safra, combinado com o cliente…"
              className={inputCls}
            />
          </div>

          {(erroForm ?? erroCriar) && (
            <p className="flex items-start gap-1.5 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-xs text-terra-escuro">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {erroForm ?? erroCriar}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-lg bg-mata px-4 py-2 text-sm font-semibold text-creme-50 shadow-carta transition hover:bg-mata-escuro disabled:opacity-50"
          >
            {enviando ? 'Cadastrando…' : 'Cadastrar rota'}
          </button>
        </form>
      </div>
    </div>
  );
}
