// A lista de ENTREGAS de um grupo (um caminhão num período) que se ARRASTA para
// reordenar — pedido da Natália, reunião de 24/09/2026, sobre o Cargo 816:
//
//   "Na cabeça dele [do Johnny], ele queria ter a opção de arrastar os cards
//    aqui e colocar na ordem que o motorista vai fazer aqueles clientes…
//    reordenar eles aqui sem alterar nada"
//
// "Sem alterar nada" é a regra: arrastar só muda a ORDEM DA PARADA (ordemRota),
// não data, período, caminhão nem motorista. Mover para outro caminhão ou
// período continua sendo reagendar, pelo modal de sempre — por isso o arrasto
// fica preso DENTRO do grupo (um SortableContext por grupo, sem soltar fora).
//
// ONDE EXISTE
// ---------------------------------------------------------------------------
// Só na visão Dia da /agendamento, e só para a logística. Quem decide é quem
// monta a árvore: o GrupoCaminhao só desenha esta lista se recebeu
// `onReordenar`, e só a página de Agendamento, na visão Dia, com `podeEscrever`,
// passa. A /agenda (somente leitura), a Semana e o Mês renderizam exatamente
// como antes — nem a alça aparece. Semana tem ~140 px por coluna: a alça
// comeria o nome do cliente e um arrasto vertical numa coluna tão estreita
// vira arrasto errado. O Mês nem desenha card.
//
// POR QUE UMA ALÇA SEPARADA
// ---------------------------------------------------------------------------
// O card inteiro já é um <button> que abre o detalhe da entrega — é o gesto
// que a equipe usa todo dia. Fazer o card inteiro arrastável transformaria
// todo clique meio tremido em arrasto (e no toque, todo scroll da página
// começando em cima de um card). E a alça não pode ficar DENTRO do card:
// botão dentro de botão é HTML inválido e o navegador desmonta o aninhamento.
// Então é um wrapper com dois irmãos: a alça (GripVertical) à esquerda e o card
// intacto ao lado.
//
// POR QUE OTIMISTA
// ---------------------------------------------------------------------------
// Arrastar e ver o card voltar para o lugar antigo durante o PATCH e o refetch
// (meio segundo, às vezes mais com o servidor do Órix lento na mesma máquina)
// parece que não pegou — e a reação natural é arrastar de novo. Então a lista
// reordena NA HORA, a partir de um estado local de override, e a chamada sai
// atrás. Deu erro: o override cai, a lista volta ao que o servidor diz e a
// página mostra o erro. Deu certo: o override fica até os dados novos chegarem
// (aí eles já trazem a ordem nova, e o override deixa de ser necessário).
//
// ESCOPO: MOTORISTA × CAMINHÃO
// ---------------------------------------------------------------------------
// A ordem gravada é do MOTORISTA no dia inteiro, não do caminhão. O grupo aqui
// é um recorte caminhão×período; quem traduz o arrasto em uma chamada por
// motorista é `reordenacoesPorMotorista` (@pastobom/shared, testada), e o
// servidor permuta essas paradas NO LUGAR — as outras paradas do motorista no
// dia (outro período, outro caminhão) ficam onde estavam.

import React from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Announcements, DragEndEvent, UniqueIdentifier } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { AgendaEntrega, PrevisaoClima } from '@pastobom/shared';
import { CardEntrega } from './CardEntrega';

/**
 * Recebe o grupo ANTES e DEPOIS do arrasto. A promessa é o contrato do
 * otimismo: rejeitou ⇒ a lista desfaz o override. Quem avisa o erro na tela é
 * quem chama (a página), não a lista.
 */
export type ReordenarGrupo = (
  antes: AgendaEntrega[],
  depois: AgendaEntrega[],
) => Promise<void>;

export interface ListaEntregasOrdenavelProps {
  entregas: AgendaEntrega[];
  compacto: boolean;
  onAbrir: (entregaId: string) => void;
  climaPorPedido?: Record<string, PrevisaoClima | null>;
  onReordenar: ReordenarGrupo;
}

/**
 * Aplica o override à lista vinda do servidor.
 *
 * Defensivo contra o override velho: id que sumiu do grupo é ignorado, e
 * entrega que apareceu depois do arrasto (outra pessoa agendou) entra no fim,
 * na ordem do servidor. Nenhum card se perde nem se duplica.
 */
function aplicarOverride(
  entregas: AgendaEntrega[],
  override: string[] | null,
): AgendaEntrega[] {
  if (override === null) return entregas;
  const porId = new Map(entregas.map((e) => [e.entregaId, e]));
  const resultado: AgendaEntrega[] = [];
  for (const id of override) {
    const e = porId.get(id);
    if (e) {
      resultado.push(e);
      porId.delete(id);
    }
  }
  for (const e of entregas) if (porId.has(e.entregaId)) resultado.push(e);
  return resultado;
}

export function ListaEntregasOrdenavel({
  entregas,
  compacto,
  onAbrir,
  climaPorPedido,
  onReordenar,
}: ListaEntregasOrdenavelProps): React.ReactElement {
  const [override, setOverride] = React.useState<string[] | null>(null);
  const [salvando, setSalvando] = React.useState(false);
  // Ref espelhando `salvando` para o efeito abaixo ler sem depender dele.
  const salvandoRef = React.useRef(false);

  // Os dados do servidor mudaram de identidade (o refetch pós-sucesso chegou, ou
  // outro refetch qualquer): eles passam a ser a verdade e o override sai. Com
  // um PATCH em voo, NÃO — um refetch que chega no meio ainda traz a ordem
  // antiga, e apagar o override ali faria o card pular de volta e depois para a
  // frente de novo.
  React.useEffect(() => {
    if (!salvandoRef.current) setOverride(null);
  }, [entregas]);

  const visiveis = React.useMemo(
    () => aplicarOverride(entregas, override),
    [entregas, override],
  );

  // PONTEIRO com distância de ativação: só vira arrasto depois de 6 px de
  // movimento, então o toque rápido na alça não é engolido e o dedo que só
  // encosta para rolar a página não arrasta nada. (A alça tem touch-action:
  // none; o resto do card continua rolando normalmente.)
  // TECLADO: foco na alça, Espaço pega, setas movem, Espaço solta, Esc desiste.
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  async function aoSoltar(evento: DragEndEvent) {
    const { active, over } = evento;
    if (!over || active.id === over.id) return;
    const de = visiveis.findIndex((e) => e.entregaId === active.id);
    const para = visiveis.findIndex((e) => e.entregaId === over.id);
    if (de < 0 || para < 0) return;

    const antes = visiveis;
    const depois = arrayMove(visiveis, de, para);
    setOverride(depois.map((e) => e.entregaId));
    salvandoRef.current = true;
    setSalvando(true);
    try {
      await onReordenar(antes, depois);
    } catch {
      // Volta ao que o servidor diz. A mensagem é da página.
      setOverride(null);
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
    }
  }

  const nomeDe = (id: UniqueIdentifier): string =>
    visiveis.find((e) => e.entregaId === id)?.clienteNome || 'entrega';
  const posicaoDe = (id: UniqueIdentifier): number =>
    visiveis.findIndex((e) => e.entregaId === id) + 1;

  // As mensagens do leitor de tela vêm em inglês por padrão no dnd-kit.
  const anuncios: Announcements = {
    onDragStart: ({ active }) =>
      `Pegou ${nomeDe(active.id)}, posição ${posicaoDe(active.id)} de ${visiveis.length}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${nomeDe(active.id)} sobre a posição ${posicaoDe(over.id)} de ${visiveis.length}.`
        : `${nomeDe(active.id)} fora da lista.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${nomeDe(active.id)} solto na posição ${posicaoDe(over.id)} de ${visiveis.length}.`
        : `${nomeDe(active.id)} solto fora da lista; nada mudou.`,
    onDragCancel: ({ active }) =>
      `Arrasto cancelado. ${nomeDe(active.id)} voltou ao lugar.`,
  };

  return (
    <DndContext
      sensors={sensores}
      collisionDetection={closestCenter}
      onDragEnd={(e) => void aoSoltar(e)}
      accessibility={{
        announcements: anuncios,
        screenReaderInstructions: {
          draggable:
            'Para mudar a ordem da parada, aperte Espaço para pegar, use as setas para mover e Espaço de novo para soltar. Esc cancela.',
        },
      }}
    >
      <SortableContext
        items={visiveis.map((e) => e.entregaId)}
        strategy={verticalListSortingStrategy}
      >
        {visiveis.map((e) => (
          <EntregaOrdenavel
            key={e.entregaId}
            entrega={e}
            compacto={compacto}
            onAbrir={onAbrir}
            clima={climaPorPedido?.[e.pedidoId] ?? null}
            // Um PATCH por vez no grupo: um segundo arrasto em cima de um
            // override ainda não confirmado, se o primeiro falhasse, seria
            // desfeito junto sem ninguém ter pedido.
            travado={salvando}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

interface EntregaOrdenavelProps {
  entrega: AgendaEntrega;
  compacto: boolean;
  onAbrir: (entregaId: string) => void;
  clima: PrevisaoClima | null;
  travado: boolean;
}

function EntregaOrdenavel({
  entrega,
  compacto,
  onAbrir,
  clima,
  travado,
}: EntregaOrdenavelProps): React.ReactElement {
  // Sem motorista não há rota: `ordemRota` é a sequência do dia de UM
  // motorista. O card continua na lista (os outros podem passar por ele), só
  // não pode ser pego.
  const semMotorista = entrega.motoristaId === null;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entrega.entregaId, disabled: semMotorista || travado });

  const titulo = semMotorista
    ? 'Sem motorista — não há rota para ordenar.'
    : travado
      ? 'Salvando a ordem…'
      : 'Arraste para mudar a ordem da parada';

  return (
    <div
      ref={setNodeRef}
      // Translate, e não Transform: os cards têm alturas diferentes (o selo do
      // tempo aparece em uns e não em outros), e o scale do Transform esticaria
      // o card durante o arrasto.
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative flex items-stretch gap-1 ${
        isDragging ? 'z-10 opacity-80' : ''
      }`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        // aria-disabled (que já vem em `attributes`) e não `disabled`: botão
        // desabilitado de verdade não mostra o `title` em todo navegador, e o
        // "Sem motorista" é justamente a explicação que precisa aparecer. Quem
        // impede o arrasto é o `disabled` do useSortable, que tira os listeners.
        aria-roledescription="alça de ordenação"
        title={titulo}
        aria-label={`${titulo}: ${entrega.clienteNome || 'cliente'}`}
        className={`flex w-5 shrink-0 touch-none items-center justify-center rounded-lg text-pedra transition focus:outline-none focus-visible:ring-2 focus-visible:ring-folha ${
          semMotorista || travado
            ? 'cursor-not-allowed opacity-40'
            : 'cursor-grab hover:bg-creme-100 hover:text-mata active:cursor-grabbing'
        }`}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <CardEntrega
          entrega={entrega}
          compacto={compacto}
          onAbrir={onAbrir}
          clima={clima}
        />
      </div>
    </div>
  );
}
