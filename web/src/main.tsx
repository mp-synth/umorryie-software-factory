import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Layout } from './components/Layout';
import { TooltipProvider } from './components/ui';
import { useTheme } from './lib/theme';
import { AgentsPage } from './pages/AgentsPage';
import { Dashboard } from './pages/Dashboard';
import { InitiativePage } from './pages/InitiativePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsagePage } from './pages/UsagePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/i/:id', element: <InitiativePage /> },
      { path: '/agents', element: <AgentsPage /> },
      { path: '/projects', element: <ProjectsPage /> },
      { path: '/usage', element: <UsagePage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <ThemedToaster />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="bottom-right" toastOptions={{ classNames: { toast: '!bg-popover !border-line-strong !text-zinc-200 !text-xs' } }} />;
}
