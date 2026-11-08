import { Navigate, Route, Routes } from 'react-router-dom';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { useData } from './hooks/useData';
import AppShell from './components/AppShell';
import AssignmentsPage from './pages/AssignmentsPage';
import RefereesPage from './pages/RefereesPage';
import RefereeDetailPage from './pages/RefereeDetailPage';
import RulesPage from './pages/RulesPage';
import AdminPage from './pages/AdminPage';

export default function App() {
  const { data, loading, error, refresh } = useData();
  if (loading) return <div className="app-message"><LoaderCircle className="spin" /><p>正在载入裁判数据…</p></div>;
  if (error || !data) return <div className="app-message"><AlertCircle /><h1>暂时无法载入数据</h1><p>{error}</p><button className="button primary" onClick={() => void refresh()}>重新加载</button></div>;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/assignments" replace />} />
        <Route path="/assignments" element={<AssignmentsPage />} />
        <Route path="/referees" element={<RefereesPage />} />
        <Route path="/referees/:id" element={<RefereeDetailPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/assignments" replace />} />
      </Route>
    </Routes>
  );
}
