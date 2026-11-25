import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { TooltipProvider } from './components/ui';
import { registerFonts } from './design/fonts';
import { startPreferences } from './lib/preferences';
import { AgentsPage } from './pages/AgentsPage';
import { AppCrash, NotFoundPage, PageCrash } from './pages/ErrorPages';
import { InboxPage } from './pages/InboxPage';
import { InitiativePage } from './pages/InitiativePage';
import { OverviewPage } from './pages/OverviewPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsagePage } from './pages/UsagePage';

registerFonts();
startPreferences();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <AppCrash />,
    children: [
      {
        errorElement: <PageCrash />,
        children: [
          { path: '/', element: <OverviewPage /> },
          { path: '/inbox', element: <InboxPage /> },
          { path: '/i/:id', element: <InitiativePage /> },
          { path: '/agents', element: <AgentsPage /> },
          { path: '/projects', element: <ProjectsPage /> },
          { path: '/usage', element: <UsagePage /> },
          { path: '/settings/:section?', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
