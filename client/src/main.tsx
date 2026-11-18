import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "./AuthGate";
import { queryClient } from "@/lib/query";
import { LanguageProvider } from "@/lib/i18n";
import "@/styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <AuthGate />
      </QueryClientProvider>
    </LanguageProvider>
  </StrictMode>,
);
