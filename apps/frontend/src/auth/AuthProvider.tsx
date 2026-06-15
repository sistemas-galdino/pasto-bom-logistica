// Contexto de autenticação: sessão Supabase + papel do usuário (lido de
// `profiles`). Expõe user, papel, estado de carregamento e ações de login/logout.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type Papel = 'logistica' | 'vendedor' | 'motorista' | 'almoxarifado';

export interface AuthState {
  /** Sessão Supabase carregando (estado inicial / troca de sessão). */
  carregando: boolean;
  session: Session | null;
  user: User | null;
  /** Papel resolvido a partir de `profiles` (null se sem perfil/sem sessão). */
  papel: Papel | null;
  /** Apenas papel 'logistica' pode aplicar transições. */
  podeEscrever: boolean;
  /** Logística e almoxarifado podem marcar a separação (RF-2.2). */
  podeSeparar: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const PAPEIS_VALIDOS: readonly Papel[] = [
  'logistica',
  'vendedor',
  'motorista',
  'almoxarifado',
];

function ehPapel(v: unknown): v is Papel {
  return typeof v === 'string' && (PAPEIS_VALIDOS as readonly string[]).includes(v);
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [carregando, setCarregando] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [papel, setPapel] = useState<Papel | null>(null);

  const carregarPapel = useCallback(async (uid: string | null) => {
    if (!uid) {
      setPapel(null);
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('papel')
      .eq('id', uid)
      .maybeSingle();
    if (error || !data || !ehPapel(data.papel)) {
      setPapel(null);
      return;
    }
    setPapel(data.papel);
  }, []);

  useEffect(() => {
    let ativo = true;

    // Sessão inicial.
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!ativo) return;
      setSession(data.session);
      await carregarPapel(data.session?.user.id ?? null);
      if (ativo) setCarregando(false);
    })();

    // Mudanças de sessão (login/logout/refresh).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      void carregarPapel(sess?.user.id ?? null);
    });

    return () => {
      ativo = false;
      sub.subscription.unsubscribe();
    };
  }, [carregarPapel]);

  const entrar = useCallback(async (email: string, senha: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });
    if (error) {
      throw new Error(traduzErroAuth(error.message));
    }
  }, []);

  const sair = useCallback(async () => {
    await supabase.auth.signOut();
    setPapel(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      carregando,
      session,
      user: session?.user ?? null,
      papel,
      podeEscrever: papel === 'logistica',
      podeSeparar: papel === 'logistica' || papel === 'almoxarifado',
      entrar,
      sair,
    }),
    [carregando, session, papel, entrar, sair],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth deve ser usado dentro de <AuthProvider>.');
  }
  return ctx;
}

function traduzErroAuth(msg: string): string {
  if (/invalid login credentials/i.test(msg)) {
    return 'E-mail ou senha inválidos.';
  }
  if (/email not confirmed/i.test(msg)) {
    return 'E-mail ainda não confirmado.';
  }
  return msg;
}
