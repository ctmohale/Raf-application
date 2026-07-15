import {
  Activity,
  Bell,
  Banknote,
  BriefcaseBusiness,
  FileText,
  FolderOpen,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { LoadingSpinner } from './LoadingSpinner.jsx';
import { apiRequest } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [firmName, setFirmName] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [messageOverview, setMessageOverview] = useState(null);
  const [activeMessageFirmId, setActiveMessageFirmId] = useState('');
  const [messageThread, setMessageThread] = useState(null);
  const [messageInput, setMessageInput] = useState('');
  const [threadSearch, setThreadSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const slugFirmMatch = useMatch('/firm/:firmId/*');
  const legacyFirmMatch = useMatch('/firms/:firmId/*');
  const firmMatch = slugFirmMatch || legacyFirmMatch;
  const firmId = firmMatch?.params?.firmId;
  const isFirmWorkspace = Boolean(firmId);
  const assignedFirms = Array.isArray(user?.firm_access) ? user.firm_access : [];
  const assignedFirm = firmId
    ? assignedFirms.find((access) => (
      String(access.firm_id) === String(firmId) || access.firm_slug === firmId
    ))
    : null;
  const firmBasePath = slugFirmMatch ? `/firm/${firmId}` : `/firms/${firmId}`;
  const canUseFirmMessages = user?.role === 'admin' || Boolean(isFirmWorkspace && assignedFirm);
  const workspaceLabel = isFirmWorkspace ? firmName || 'Firm Workspace' : user?.role === 'admin' ? 'Admin Workspace' : 'Claims workspace';
  const overviewRows = messageOverview?.rows || [];
  const filteredOverviewRows = overviewRows.filter((row) => {
    const searchValue = threadSearch.trim().toLowerCase();
    if (!searchValue) return true;

    return [
      row.firm?.name,
      row.firm?.slug,
      row.latest_message?.body,
      row.latest_message?.sender_name
    ].filter(Boolean).join(' ').toLowerCase().includes(searchValue);
  });
  const activeFirmKey = isFirmWorkspace ? firmId : activeMessageFirmId;
  const activeOverview = overviewRows.find((row) => (
    String(row.firm.id) === String(activeFirmKey) || row.firm.slug === activeFirmKey
  ));
  const notificationCount = isFirmWorkspace
    ? Number(activeOverview?.unread_firm || 0) + Number(activeOverview?.reminders_due || 0)
    : Number(messageOverview?.totals?.unread_admin || 0) + Number(messageOverview?.totals?.reminders_due || 0);
  const chatTitle = isFirmWorkspace ? 'Admin chat' : activeOverview?.firm?.name || 'Firm messages';
  const chatSubtitle = isFirmWorkspace
    ? workspaceLabel
    : activeOverview?.latest_message
      ? 'Admin to firm conversation'
      : `${overviewRows.length} firm thread(s)`;

  function getInitials(value) {
    return String(value || 'RF')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('');
  }

  function isOutgoingMessage(message) {
    return isFirmWorkspace ? message.sender_type === 'firm' : message.sender_type === 'admin';
  }

  useEffect(() => {
    let ignore = false;

    if (!firmId) {
      setFirmName('');
      return () => {
        ignore = true;
      };
    }

    setFirmName('');
    apiRequest(`/api/firms/${firmId}/workspace`)
      .then((workspace) => {
        if (!ignore) setFirmName(workspace?.firm?.name || '');
      })
      .catch(() => {
        if (!ignore) setFirmName('');
      });

    return () => {
      ignore = true;
    };
  }, [firmId]);

  useEffect(() => {
    if (!notificationsOpen || !canUseFirmMessages) return;
    if (user?.role === 'admin') {
      loadMessageOverview().catch((err) => setNotificationError(err.message));
    } else if (isFirmWorkspace && firmId) {
      loadMessageThread(firmId, 'firm').catch((err) => setNotificationError(err.message));
    }
  }, [notificationsOpen, firmId, canUseFirmMessages, user?.role, isFirmWorkspace]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    loadMessageOverview().catch(() => {});
  }, [firmId, isFirmWorkspace, user?.role]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setGlobalSearch(params.get('q') || '');
  }, [location.search]);

  useEffect(() => {
    if (!notificationsOpen || !activeFirmKey || !canUseFirmMessages) return;
    loadMessageThread(activeFirmKey, isFirmWorkspace ? 'firm' : 'admin').catch((err) => setNotificationError(err.message));
  }, [notificationsOpen, activeFirmKey, isFirmWorkspace, canUseFirmMessages]);

  async function loadMessageOverview() {
    setNotificationError('');
    setNotificationsLoading(true);

    try {
      const result = await apiRequest('/api/firms/messages/overview');
      setMessageOverview(result);

      if (!isFirmWorkspace && !activeMessageFirmId && result.rows?.length) {
        const nextFirm = result.rows.find((row) => row.unread_admin > 0) || result.rows[0];
        setActiveMessageFirmId(String(nextFirm.firm.id));
      }

      return result;
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function loadMessageThread(targetFirmId, readerType) {
    setNotificationError('');
    setNotificationsLoading(true);

    try {
      const result = await apiRequest(`/api/firms/${targetFirmId}/messages/read`, {
        method: 'PATCH',
        body: { reader_type: readerType }
      });
      setMessageThread(result);
      return result;
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function sendFirmMessage(event) {
    event.preventDefault();
    const targetFirmId = isFirmWorkspace ? firmId : activeMessageFirmId;
    const body = messageInput.trim();
    if (!targetFirmId || !body) return;

    try {
      setNotificationError('');
      setSendingMessage(true);
      const result = await apiRequest(`/api/firms/${targetFirmId}/messages`, {
        method: 'POST',
        body: {
          body,
          sender_type: isFirmWorkspace ? 'firm' : 'admin'
        }
      });
      setMessageThread(result);
      setMessageInput('');
      await loadMessageOverview();
    } catch (err) {
      setNotificationError(err.message);
    } finally {
      setSendingMessage(false);
    }
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function handleGlobalSearch(event) {
    event.preventDefault();
    const query = globalSearch.trim();
    const adminSearchPaths = ['/firms', '/billing', '/activity', '/templates', '/documents'];
    const firmSearchPaths = [`${firmBasePath}/clients`, `${firmBasePath}/doctors`, `${firmBasePath}/claims`, `${firmBasePath}/billing`];
    const currentPath = location.pathname;
    const targetPath = isFirmWorkspace
      ? firmSearchPaths.includes(currentPath) ? currentPath : `${firmBasePath}/claims`
      : adminSearchPaths.includes(currentPath) ? currentPath : '/firms';
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    navigate({ pathname: targetPath, search: params.toString() ? `?${params.toString()}` : '' });
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
	        <div className="brand">
	          <div className="brand-mark">RF</div>
	          <div>
	            <strong>RAFFlow</strong>
	            <span>{workspaceLabel}</span>
	          </div>
            <button
              className="mobile-nav-toggle"
              type="button"
              aria-controls="mobile-navigation"
              aria-expanded={mobileNavOpen}
              aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
              onClick={() => setMobileNavOpen((current) => !current)}
            >
              {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
	        </div>
        <div className="mobile-nav-content" id="mobile-navigation">
          <nav className="nav-list">
            {isFirmWorkspace ? (
              <>
                <NavLink to={`${firmBasePath}/workspace`}><Home size={18} /> Dashboard</NavLink>
                <NavLink to={`${firmBasePath}/clients`}><Users size={18} /> Clients</NavLink>
                <NavLink to={`${firmBasePath}/doctors`}><Stethoscope size={18} /> Doctors</NavLink>
                <NavLink to={`${firmBasePath}/claims`}><BriefcaseBusiness size={18} /> Claims</NavLink>
                <NavLink to={`${firmBasePath}/billing`}><Banknote size={18} /> Billing</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/"><Home size={18} /> Dashboard</NavLink>
                {user?.role === 'admin' && <NavLink to="/firms"><FolderOpen size={18} /> Law firms</NavLink>}
                {user?.role === 'admin' && <NavLink to="/billing"><Banknote size={18} /> Billing</NavLink>}
                {user?.role === 'admin' && <NavLink to="/activity"><Activity size={18} /> Activity</NavLink>}
                {assignedFirms.map((access) => (
                  <NavLink to={`/firm/${access.firm_slug || access.firm_id}/workspace`} key={access.firm_id}>
                    <BriefcaseBusiness size={18} /> {access.firm_name || 'Firm workspace'}
                  </NavLink>
                ))}
                <NavLink to="/templates"><FolderOpen size={18} /> Templates</NavLink>
                <NavLink to="/documents"><FileText size={18} /> Documents</NavLink>
              </>
            )}
          </nav>
          {!isFirmWorkspace && (
            <div className="sidebar-section">
	              <span>Settings</span>
	              <nav className="nav-list">
	                <NavLink to="/settings/workspace"><Settings size={18} /> Workspace</NavLink>
	                <NavLink to="/settings/security"><ShieldCheck size={18} /> Security</NavLink>
	              </nav>
	            </div>
          )}
          <div className="sidebar-summary">
            <span>Secure workspace</span>
            <strong>{isFirmWorkspace ? 'Firm claim files' : 'RAF claim files'}</strong>
            <div className="storage-bar"><i /></div>
            <small>Encrypted local document storage</small>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <form className="search-bar" aria-label="Search" role="search" onSubmit={handleGlobalSearch}>
            <Search size={18} />
            <input
              type="search"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder={isFirmWorkspace ? 'Search this firm workspace...' : 'Search firms, applications, documents...'}
            />
          </form>
	          <div className="user-menu">
	            {canUseFirmMessages && <button
	              className="icon-button notification-button"
	              type="button"
	              title="Notifications"
	              aria-label="Notifications"
	              onClick={() => setNotificationsOpen((current) => !current)}
	            >
	              <Bell size={18} />
	              {notificationCount > 0 && <span>{notificationCount}</span>}
	            </button>}
		            {canUseFirmMessages && notificationsOpen && (
		              <section className="notification-panel" aria-label="Notifications and messages">
		                <div className="notification-header">
		                  <div className="chat-avatar" aria-hidden="true">{getInitials(chatTitle)}</div>
		                  <div className="notification-title">
		                    <strong>{chatTitle}</strong>
		                    <span>{chatSubtitle}</span>
		                  </div>
		                  <button className="icon-button notification-close" type="button" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications">
		                    <X size={16} />
	                  </button>
	                </div>
	                {notificationError && <div className="notification-error">{notificationError}</div>}
	                {notificationsLoading && !messageThread && (
	                  <div className="notification-loading">
	                    <LoadingSpinner size="sm" label="Loading notifications..." />
	                    <span>Loading notifications...</span>
	                  </div>
	                )}
		                {!isFirmWorkspace && overviewRows.length > 0 && (
		                  <label className="notification-search" aria-label="Search firm threads">
		                    <Search size={15} />
		                    <input
		                      type="search"
		                      value={threadSearch}
		                      onChange={(event) => setThreadSearch(event.target.value)}
		                      placeholder="Search firm threads"
		                    />
		                  </label>
		                )}
		                {!isFirmWorkspace && overviewRows.length > 0 && threadSearch.trim() && (
		                  <div className="thread-picker">
		                    {filteredOverviewRows.map((row) => (
		                      <button
		                        type="button"
		                        className={String(row.firm.id) === String(activeMessageFirmId) ? 'active' : ''}
	                        key={row.firm.id}
	                        onClick={() => setActiveMessageFirmId(String(row.firm.id))}
	                      >
	                        <span>{row.firm.name}</span>
	                        <small>{row.unread_admin > 0 ? `${row.unread_admin} unread` : row.reminders_due > 0 ? `${row.reminders_due} reminder(s) due` : 'No alerts'}</small>
		                      </button>
		                    ))}
		                    {filteredOverviewRows.length === 0 && (
		                      <div className="thread-search-empty">No matching firm threads.</div>
		                    )}
		                  </div>
		                )}
	                {!notificationsLoading && overviewRows.length === 0 && <p className="muted">No firm notifications yet.</p>}
		                {messageThread && (
		                  <>
		                    <div className="message-thread">
		                      {messageThread.messages.length === 0 && (
		                        <div className="chat-empty">
		                          <MessageSquare size={22} />
		                          <strong>No messages yet</strong>
		                          <span>Start the conversation below.</span>
		                        </div>
		                      )}
		                      {messageThread.messages.map((message) => (
		                        <article className={`message-bubble ${isOutgoingMessage(message) ? 'outgoing' : 'incoming'} ${message.sender_type}`} key={message.id}>
		                          <div className="message-author">{message.sender_name}</div>
		                          <p>{message.body}</p>
		                          <time dateTime={message.created_at}>
		                            {new Date(message.created_at).toLocaleString([], {
		                              day: '2-digit',
		                              month: '2-digit',
		                              hour: '2-digit',
		                              minute: '2-digit'
		                            })}
		                          </time>
		                        </article>
		                      ))}
		                    </div>
	                    <form className="message-compose" onSubmit={sendFirmMessage}>
	                      <MessageSquare size={16} />
	                      <input
	                        value={messageInput}
	                        onChange={(event) => setMessageInput(event.target.value)}
	                        placeholder={isFirmWorkspace ? 'Message admin' : 'Message firm'}
	                      />
	                      <button className="icon-button" type="submit" disabled={!messageInput.trim() || sendingMessage} aria-label="Send message">
	                        {sendingMessage ? <LoadingSpinner size="sm" label="Sending message..." /> : <Send size={15} />}
	                      </button>
	                    </form>
	                  </>
	                )}
	              </section>
	            )}
	            <button className="icon-button theme-toggle active" type="button" title="Theme" aria-label="Theme">
              <Moon size={18} />
            </button>
            <div className="profile-pill">
              <div className="avatar" aria-hidden="true">{user?.name?.charAt(0) || 'S'}</div>
              <div className="user-copy">
                <strong>{user?.name || 'Shane'}</strong>
                <span>{user?.role || 'Claims admin'}</span>
              </div>
            </div>
            <button className="icon-button" onClick={handleLogout} title="Log out" aria-label="Log out">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
