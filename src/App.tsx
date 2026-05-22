import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CloudSyncProvider } from "@/lib/cloudSync";
import { I18nProvider } from "@/lib/i18n";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();
const Router = window.location.protocol === "file:" ? HashRouter : BrowserRouter;

const App = () => (
  <I18nProvider>
    <CloudSyncProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Router>
            <Routes>
              <Route path="/" element={<Index />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Router>
        </TooltipProvider>
      </QueryClientProvider>
    </CloudSyncProvider>
  </I18nProvider>
);

export default App;
