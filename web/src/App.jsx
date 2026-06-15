import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import MainLayout from './components/MainLayout.jsx';
import TenantDashboard from './pages/TenantDashboard.jsx';
import ManagerDashboard from './pages/ManagerDashboard.jsx';
import SupervisorDashboard from './pages/SupervisorDashboard.jsx';
import InspectorDashboard from './pages/InspectorDashboard.jsx';
import FinanceDashboard from './pages/FinanceDashboard.jsx';
import RequestDetail from './pages/RequestDetail.jsx';

export default function App() {
  const [auth, setAuth] = useState(() => {
    const saved = localStorage.getItem('repair_auth');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    if (auth) {
      localStorage.setItem('repair_auth', JSON.stringify(auth));
    } else {
      localStorage.removeItem('repair_auth');
    }
  }, [auth]);

  const handleLogin = (data) => setAuth(data);
  const handleLogout = () => setAuth(null);

  if (!auth) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <MainLayout auth={auth} onLogout={handleLogout}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={
          auth.user.role === 'tenant' ? <TenantDashboard auth={auth} /> :
          auth.user.role === 'housing_manager' ? <ManagerDashboard auth={auth} /> :
          auth.user.role === 'supervisor' ? <SupervisorDashboard auth={auth} /> :
          auth.user.role === 'inspector' ? <InspectorDashboard auth={auth} /> :
          <FinanceDashboard auth={auth} />
        } />
        <Route path="/requests/:id" element={<RequestDetail auth={auth} />} />
      </Routes>
    </MainLayout>
  );
}
