// Composição do app: provedores (react-query + auth) e rotas.
// /login é pública; a casca de equipe (dashboard/entregas/rotas/motoristas) e
// /rota (motorista) exigem sessão.
// O destino pós-login depende do papel: motorista vai para /rota; demais, /dashboard.

import React from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth, type Papel } from './auth/AuthProvider';
import { Login } from './auth/Login';
import { AppShell } from './components/layout/AppShell';
import { Board } from './pages/Board';
import { Dashboard } from './pages/Dashboard';
import { Rotas } from './pages/Rotas';
import { Motoristas } from './pages/Motoristas';
import { RotaDoDia } from './pages/RotaDoDia';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Página inicial conforme o papel do usuário. */
function homePath(papel: Papel | null): string {
  return papel === 'motorista' ? '/rota' : '/dashboard';
}

function TelaCarregando(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-tinta-suave">
      Carregando…
    </div>
  );
}

/** Bloqueia rotas que exigem sessão; redireciona ao login preservando destino. */
function RotaProtegida({
  children,
}: {
  children: React.ReactElement;
}): React.ReactElement {
  const { carregando, session } = useAuth();
  const location = useLocation();

  if (carregando) return <TelaCarregando />;
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

/** Mantém o motorista fora do quadro da equipe (manda p/ a rota do dia). */
function SomenteEquipe({
  children,
}: {
  children: React.ReactElement;
}): React.ReactElement {
  const { ehMotorista } = useAuth();
  if (ehMotorista) return <Navigate to="/rota" replace />;
  return children;
}

/** Mantém a equipe fora da tela do motorista (manda p/ o quadro). */
function SomenteMotorista({
  children,
}: {
  children: React.ReactElement;
}): React.ReactElement {
  const { papel, ehMotorista } = useAuth();
  if (papel && !ehMotorista) return <Navigate to="/dashboard" replace />;
  return children;
}

/** Em /login, se já houver sessão, manda ao destino do papel. */
function RotaLogin(): React.ReactElement {
  const { carregando, session, papel } = useAuth();
  if (carregando) return <TelaCarregando />;
  if (session) return <Navigate to={homePath(papel)} replace />;
  return <Login />;
}

/** Catch-all: leva ao destino do papel (ou ao login, via RotaProtegida). */
function HomeRedirect(): React.ReactElement {
  const { carregando, papel } = useAuth();
  if (carregando) return <TelaCarregando />;
  return <Navigate to={homePath(papel)} replace />;
}

export function App(): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<RotaLogin />} />
            <Route
              element={
                <RotaProtegida>
                  <SomenteEquipe>
                    <AppShell />
                  </SomenteEquipe>
                </RotaProtegida>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/entregas" element={<Board />} />
              <Route path="/rotas" element={<Rotas />} />
              <Route path="/motoristas" element={<Motoristas />} />
            </Route>
            <Route path="/board" element={<Navigate to="/entregas" replace />} />
            <Route
              path="/rota"
              element={
                <RotaProtegida>
                  <SomenteMotorista>
                    <RotaDoDia />
                  </SomenteMotorista>
                </RotaProtegida>
              }
            />
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
