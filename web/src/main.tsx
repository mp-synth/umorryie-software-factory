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
import { AgentsPage } from './pages/AgentsPage';
import { Dashboard } from './pages/Dashboard';
import { InitiativePage } from './pages/InitiativePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';

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
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{ classNames: { toast: '!bg-[#17171e] !border-[#30303c] !text-zinc-200 !text-xs' } }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
