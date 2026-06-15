// Mapas de apresentação dos papéis de usuário (rótulo, badge e descrição de
// acesso). Fonte única reusada por Header e Sidebar.

import type { Papel } from '../auth/AuthProvider';

export const PAPEL_ROTULO: Record<Papel, string> = {
  logistica: 'Logística',
  vendedor: 'Vendedor',
  motorista: 'Motorista',
  almoxarifado: 'Almoxarifado',
};

export const PAPEL_BADGE: Record<Papel, string> = {
  logistica: 'bg-mata-claro text-mata-escuro',
  vendedor: 'bg-folha-claro text-mata',
  motorista: 'bg-trigo-claro text-trigo-escuro',
  almoxarifado: 'bg-terra-claro text-terra-escuro',
};

export const PAPEL_ACESSO: Record<Papel, string> = {
  logistica: 'Acesso total',
  almoxarifado: 'Separação de mercadorias',
  vendedor: 'Somente leitura',
  motorista: 'Rota do dia',
};
