// Contatos do cliente, logo abaixo do nome — pedido da Natália (06/11/2026):
// ao agendar, a logística liga para combinar o dia. Vão os dois campos do Órix,
// celular e telefone, cada um com o seu rótulo. Cada número é um link tel:,
// então no celular um toque já disca.

import React from 'react';
import { Phone } from 'lucide-react';
import type { ContatoTelefone } from '@pastobom/shared';
import { formatarTelefone } from '../lib/format';

const ROTULO: Record<ContatoTelefone['tipo'], string> = {
  celular: 'Cel.',
  telefone: 'Tel.',
};

interface Props {
  telefones: ContatoTelefone[];
  className?: string;
}

export function ContatoCliente({ telefones, className = '' }: Props): React.ReactElement {
  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-tinta-suave ${className}`}>
      <Phone className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
      {telefones.length === 0 ? (
        <span className="text-pedra">Sem telefone no cadastro</span>
      ) : (
        telefones.map((t, i) => (
          <React.Fragment key={`${t.tipo}-${t.numero}`}>
            {i > 0 && <span className="text-pedra">·</span>}
            <span>
              {/* Rótulo só quando há mais de um: com um número só, "Tel." não
                  acrescenta nada. */}
              {telefones.length > 1 && (
                <span className="mr-1 text-pedra">{ROTULO[t.tipo]}</span>
              )}
              <a
                href={`tel:${t.numero.replace(/[^\d+]/g, '')}`}
                onClick={(e) => e.stopPropagation()}
                className="font-semibold text-tinta hover:text-mata hover:underline"
              >
                {formatarTelefone(t.numero)}
              </a>
            </span>
          </React.Fragment>
        ))
      )}
    </p>
  );
}
