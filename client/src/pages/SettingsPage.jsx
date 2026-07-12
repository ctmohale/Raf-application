import { ShieldCheck, Settings } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';

export default function SettingsPage({ section = 'workspace' }) {
  const { user } = useAuth();
  const isSecurity = section === 'security';

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>{isSecurity ? 'Security' : 'Workspace settings'}</h2>
          <p>{isSecurity ? 'Session and access controls for this workspace.' : 'Workspace defaults and operational status.'}</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>{isSecurity ? 'Access' : 'Workspace'}</h3>
            <p>{isSecurity ? 'Signed-in user and role information.' : 'Current app workspace configuration.'}</p>
          </div>
          {isSecurity ? <ShieldCheck size={18} /> : <Settings size={18} />}
        </div>
        <div className="table-list">
          <div className="workspace-row">
            <strong>{isSecurity ? 'Signed in as' : 'Application'}</strong>
            <span>{isSecurity ? `${user?.name || 'User'} · ${user?.role || 'role pending'}` : 'RAFFlow document and firm management'}</span>
          </div>
          <div className="workspace-row">
            <strong>{isSecurity ? 'Email' : 'Storage'}</strong>
            <span>{isSecurity ? user?.email || '-' : 'Firm databases and client uploads are separated by firm'}</span>
          </div>
        </div>
      </section>
    </section>
  );
}
