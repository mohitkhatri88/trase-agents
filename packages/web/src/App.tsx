import { Navigate, Route, Routes } from "react-router";
import { AgentsPage } from "./pages/AgentsPage.js";
import { AllTasksPage } from "./pages/AllTasksPage.js";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/agents" replace />} />
      <Route path="/agents" element={<AgentsPage />} />
      <Route path="/agents/:agentId" element={<AgentsPage />} />
      <Route path="/tasks" element={<AllTasksPage />} />
      <Route path="*" element={<Navigate to="/agents" replace />} />
    </Routes>
  );
}
