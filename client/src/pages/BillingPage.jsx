import { useEffect, useState } from 'react';
import { Banknote, Building2, Calculator, FileText, Filter, Save, Search, Users } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ButtonSpinner, LoadingSpinner, PageLoader } from '../components/LoadingSpinner.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../lib/api.js';

const currencyFormatter = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR'
});

export default function BillingPage() {
  const { id: firmId } = useParams();
  const isFirmBilling = Boolean(firmId);
  const [billing, setBilling] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [rateInput, setRateInput] = useState('500');
  const [firmRateInputs, setFirmRateInputs] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [savingRate, setSavingRate] = useState(false);
  const [savingFirmRate, setSavingFirmRate] = useState(null);

  function applyBillingResult(result) {
    const nextFirmRates = {};
    for (const row of result.rows || []) {
      nextFirmRates[row.firm_id] = String(row.rate_per_application);
    }

    setBilling(result);
    setRateInput(String(result.rate_per_application));
    setFirmRateInputs(nextFirmRates);
  }

  useEffect(() => {
    apiRequest(isFirmBilling ? `/api/billing/firm/${firmId}` : '/api/billing')
      .then(applyBillingResult)
      .catch((err) => setError(err.message));
  }, [firmId, isFirmBilling]);

  const rows = billing?.rows || [];
  const filteredRows = rows.filter((row) => {
    const searchText = [
      row.firm_name,
      row.slug,
      row.contact_email,
      row.status
    ].filter(Boolean).join(' ').toLowerCase();

    const matchesSearch = searchText.includes(searchTerm.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || row.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const statuses = [...new Set(rows.map((row) => row.status))];
  const hasCustomRates = rows.some((row) => row.custom_rate_per_application != null);

  async function updateBillingRate(event) {
    event.preventDefault();
    setSavingRate(true);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest('/api/billing/rate', {
        method: 'PATCH',
        body: { rate_per_application: Number(rateInput) }
      });
      applyBillingResult(result);
      setMessage(`Default billing rate updated to ${currencyFormatter.format(result.rate_per_application)} per application.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingRate(false);
    }
  }

  async function updateFirmBillingRate(event, row) {
    event.preventDefault();
    setSavingFirmRate(row.firm_id);
    setError('');
    setMessage('');

    try {
      const result = await apiRequest(`/api/billing/firms/${row.firm_id}/rate`, {
        method: 'PATCH',
        body: { rate_per_application: Number(firmRateInputs[row.firm_id]) }
      });
      applyBillingResult(result);
      setMessage(`${row.firm_name} rate updated to ${currencyFormatter.format(Number(firmRateInputs[row.firm_id]))} per application.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingFirmRate(null);
    }
  }

  if (!billing && !error) return <PageLoader label="Loading billing..." />;

  return (
    <section className="page-stack">
      <div className="section-header">
        <div>
          <h2>Billing</h2>
          <p>{isFirmBilling ? `Billing usage for ${billing?.firm?.name || 'this firm'}.` : 'Bill law firms based on each RAF client application being processed.'}</p>
        </div>
      </div>

      <StatusMessage type="error">{error}</StatusMessage>
      <StatusMessage type="success">{message}</StatusMessage>

      {billing && (
        <>
          <div className="firm-stats billing-stats">
            <div className="metric">
              <div className="firm-stat-top">
                <span className="metric-icon"><Building2 size={22} /></span>
                <strong>{billing.summary.firms}</strong>
              </div>
              <div className="metric-body">
                <span>Law firms</span>
              </div>
              <small>{isFirmBilling ? 'Current firm workspace' : 'Firms included in billing'}</small>
            </div>
            <div className="metric">
              <div className="firm-stat-top">
                <span className="metric-icon"><Users size={22} /></span>
                <strong>{billing.summary.clients}</strong>
              </div>
              <div className="metric-body">
                <span>Clients</span>
              </div>
              <small>Client records across firms</small>
            </div>
            <div className="metric">
              <div className="firm-stat-top">
                <span className="metric-icon"><FileText size={22} /></span>
                <strong>{billing.summary.applications}</strong>
              </div>
              <div className="metric-body">
                <span>Applications</span>
              </div>
              <small>Billable RAF cases processed</small>
            </div>
            <div className="metric">
              <div className="firm-stat-top">
                <span className="metric-icon"><Banknote size={22} /></span>
                <strong>{currencyFormatter.format(billing.summary.amount_due)}</strong>
              </div>
              <div className="metric-body">
                <span>Amount due</span>
              </div>
              <small>
                {isFirmBilling
                  ? `${currencyFormatter.format(rows[0]?.rate_per_application || billing.rate_per_application)} per application`
                  : hasCustomRates
                    ? `Default ${currencyFormatter.format(billing.rate_per_application)}; firm rates included`
                    : `${currencyFormatter.format(billing.rate_per_application)} per application`}
              </small>
            </div>
          </div>

          <section className="panel">
            <div className="panel-header firm-table-header">
              <div>
                <h3>{isFirmBilling ? 'Company billing usage' : 'Firm billing'}</h3>
                <p>{isFirmBilling ? 'Usage calculated only from this firm database.' : 'Billing totals calculated from each firm database.'}</p>
              </div>
              {!isFirmBilling && <div className="firm-table-tools">
                <form className="billing-rate-control" onSubmit={updateBillingRate}>
                  <label>
                    Default rate
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={rateInput}
                      onChange={(event) => setRateInput(event.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={savingRate}>{savingRate ? <ButtonSpinner label="Saving..." /> : 'Update rate'}</button>
                </form>
                <label className="table-search" aria-label="Search billing">
                  <Search size={16} />
                  <input
                    type="search"
                    placeholder="Search firms"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                </label>
                <label className="table-filter" aria-label="Filter billing by status">
                  <Filter size={16} />
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="all">All status</option>
                    {statuses.map((status) => (
                      <option value={status} key={status}>{status}</option>
                    ))}
                  </select>
                </label>
              </div>}
            </div>

            <div className="firm-table-wrap billing-table-wrap">
              {filteredRows.length === 0 && <p className="muted">No billing records match the selected filters.</p>}
              {filteredRows.length > 0 && (
                <table className="firm-table billing-table">
                  <thead>
                    <tr>
                      <th>Firm</th>
                      <th>Clients</th>
                      <th>Applications</th>
                      <th>Open apps</th>
                      <th>Uploads</th>
                      <th>Rate</th>
                      <th>Amount due</th>
                      <th>Last application</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr key={row.firm_id}>
                        <td>
                          <strong>{row.firm_name}</strong>
                          <span>{row.contact_email || row.slug}</span>
                        </td>
                        <td>{row.clients}</td>
                        <td>{row.applications}</td>
                        <td>{row.open_applications}</td>
                        <td>{row.uploaded_documents}</td>
                        <td>
                          {!isFirmBilling && (
                            <form className="firm-rate-control" onSubmit={(event) => updateFirmBillingRate(event, row)}>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                aria-label={`Rate for ${row.firm_name}`}
                                value={firmRateInputs[row.firm_id] ?? String(row.rate_per_application)}
                                onChange={(event) => setFirmRateInputs((current) => ({
                                  ...current,
                                  [row.firm_id]: event.target.value
                                }))}
                              />
                              <button
                                type="submit"
                                disabled={savingFirmRate === row.firm_id}
                                title={`Save rate for ${row.firm_name}`}
                                aria-label={`Save rate for ${row.firm_name}`}
                              >
                                {savingFirmRate === row.firm_id ? <LoadingSpinner size="sm" label={`Saving rate for ${row.firm_name}`} /> : <Save size={14} />}
                              </button>
                            </form>
	                          )}
	                          {isFirmBilling && currencyFormatter.format(row.rate_per_application)}
	                        </td>
                        <td><code>{currencyFormatter.format(row.amount_due)}</code></td>
                        <td>{row.last_application_at ? new Date(row.last_application_at).toLocaleDateString() : '-'}</td>
                        <td><span className={`status-pill ${row.status}`}>{row.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {!isFirmBilling && <section className="panel billing-note">
            <Calculator size={20} />
            <div>
              <h3>Billing rule</h3>
              <p>Each law firm is billed once per RAF case opened for a client. The default rate applies until an admin sets a firm-specific rate in the table.</p>
            </div>
          </section>}
        </>
      )}
    </section>
  );
}
