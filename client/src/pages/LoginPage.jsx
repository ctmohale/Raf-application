import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { ButtonSpinner } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function LoginPage() {
  const { login, register, isAuthenticated } = useAuth();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberLogin, setRememberLogin] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'login') {
        await login(email, password, { remember: rememberLogin });
      } else {
        const result = await register(name, email, password);
        if (result.pendingApproval) {
          setMessage(result.message || 'Account created. An administrator must approve your access before you can sign in.');
          setMode('login');
          setPassword('');
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="brand-mark large"><FileText size={28} /></div>
          <div>
            <span className="eyebrow">Document automation</span>
            <h1>ORC Automation Studio</h1>
          </div>
        </div>

        <div className="segmented">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register</button>
        </div>

        <form className="form-stack" onSubmit={handleSubmit} autoComplete="on">
          {mode === 'register' && (
            <label htmlFor="auth-name">
              Name
              <input
                id="auth-name"
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
              />
            </label>
          )}
          <label htmlFor="auth-email">
            Email
            <input
              id="auth-email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete={mode === 'login' ? 'username' : 'email'}
              autoCapitalize="none"
              spellCheck="false"
              required
            />
          </label>
          <label htmlFor="auth-password">
            Password
            <input
              id="auth-password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={8}
            />
          </label>
          {mode === 'login' && (
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={rememberLogin}
                onChange={(event) => setRememberLogin(event.target.checked)}
                autoComplete="on"
              />
              Remember me
            </label>
          )}
          <StatusMessage type="success">{message}</StatusMessage>
          <StatusMessage type="error">{error}</StatusMessage>
          <button className="primary-button" disabled={loading}>
            {loading ? <ButtonSpinner label="Working..." /> : mode === 'login' ? 'Login' : 'Create account'}
          </button>
        </form>
      </section>
    </main>
  );
}
