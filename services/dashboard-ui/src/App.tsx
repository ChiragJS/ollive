import { Routes, Route, Navigate } from "react-router-dom";
import { SideNav } from "./components/SideNav";
import { OverviewPage } from "./pages/OverviewPage";
import { LogsPage } from "./pages/LogsPage";
import { LogDetailPage } from "./pages/LogDetailPage";
import { ModelsPage } from "./pages/ModelsPage";

export default function App() {
  return (
    <div className="app">
      <SideNav />
      <main className="main">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/logs/:id" element={<LogDetailPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
