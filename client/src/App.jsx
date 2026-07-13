import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import AppShell from './components/AppShell.jsx';
import ActivityLogsPage from './pages/ActivityLogsPage.jsx';
import BillingPage from './pages/BillingPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import DocumentsPage from './pages/DocumentsPage.jsx';
import DocumentPreviewPage from './pages/DocumentPreviewPage.jsx';
import FirmsPage from './pages/FirmsPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import MedicalAssessmentPage from './pages/MedicalAssessmentPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import SpreadsheetMappingPage from './pages/SpreadsheetMappingPage.jsx';
import TemplateEditorPage from './pages/TemplateEditorPage.jsx';
import TemplatesPage from './pages/TemplatesPage.jsx';
import DataEntryFormPage from './pages/DataEntryFormPage.jsx';
import ClientUploadPage from './pages/ClientUploadPage.jsx';
import FirmClaimsPage from './pages/FirmClaimsPage.jsx';
import FirmClientsPage from './pages/FirmClientsPage.jsx';
import FirmWorkspacePage from './pages/FirmWorkspacePage.jsx';

function Protected({ children }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <AppShell>{children}</AppShell>;
}

function FirmWorkspaceRedirect() {
  const { id } = useParams();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/firms/') ? '/firms' : '/firm';
  return <Navigate to={`${basePath}/${id}/workspace`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/client-upload/:token" element={<ClientUploadPage />} />
      <Route path="/medical-assessment/:token" element={<MedicalAssessmentPage />} />
      <Route path="/" element={<Protected><DashboardPage /></Protected>} />
      <Route path="/activity" element={<Protected><ActivityLogsPage /></Protected>} />
      <Route path="/billing" element={<Protected><BillingPage /></Protected>} />
      <Route path="/firms" element={<Protected><FirmsPage /></Protected>} />
      <Route path="/firms/:id/workspace" element={<Protected><FirmWorkspacePage /></Protected>} />
      <Route path="/firms/:id/clients" element={<Protected><FirmClientsPage /></Protected>} />
      <Route path="/firms/:id/claims" element={<Protected><FirmClaimsPage /></Protected>} />
      <Route path="/firms/:id/billing" element={<Protected><BillingPage /></Protected>} />
      <Route path="/firms/:id/templates" element={<Protected><FirmWorkspaceRedirect /></Protected>} />
      <Route path="/firms/:id/documents" element={<Protected><FirmWorkspaceRedirect /></Protected>} />
      <Route path="/firm/:id/workspace" element={<Protected><FirmWorkspacePage /></Protected>} />
      <Route path="/firm/:id/clients" element={<Protected><FirmClientsPage /></Protected>} />
      <Route path="/firm/:id/claims" element={<Protected><FirmClaimsPage /></Protected>} />
      <Route path="/firm/:id/billing" element={<Protected><BillingPage /></Protected>} />
      <Route path="/firm/:id/templates" element={<Protected><FirmWorkspaceRedirect /></Protected>} />
      <Route path="/firm/:id/documents" element={<Protected><FirmWorkspaceRedirect /></Protected>} />
      <Route path="/templates" element={<Protected><TemplatesPage /></Protected>} />
      <Route path="/templates/upload" element={<Navigate to="/templates" replace />} />
      <Route path="/templates/:id/edit" element={<Protected><TemplateEditorPage /></Protected>} />
      <Route path="/templates/:id/form" element={<Protected><DataEntryFormPage /></Protected>} />
      <Route path="/templates/:id/spreadsheet" element={<Protected><SpreadsheetMappingPage /></Protected>} />
      <Route path="/documents" element={<Protected><DocumentsPage /></Protected>} />
      <Route path="/documents/:id" element={<Protected><DocumentPreviewPage /></Protected>} />
      <Route path="/settings/workspace" element={<Protected><SettingsPage section="workspace" /></Protected>} />
      <Route path="/settings/security" element={<Protected><SettingsPage section="security" /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
