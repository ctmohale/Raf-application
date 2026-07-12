import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Building2,
  CalendarDays,
  Download,
  FileCheck2,
  FileText,
  MoreHorizontal,
  Scale,
  Users
} from 'lucide-react';
import StatusMessage from '../components/StatusMessage.jsx';
import { PageLoader } from '../components/LoadingSpinner.jsx';
import { apiRequest } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const currencyFormatter = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR'
});

function Metric({ icon, label, value, update }) {
  return (
    <div className="metric">
      <span className="metric-icon">{icon}</span>
      <div className="metric-body">
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
      <small>{update}</small>
    </div>
  );
}

function getFirmInitials(name) {
  return String(name || 'Firm')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest('/api/dashboard').then(setStats).catch((err) => setError(err.message));
  }, []);

  if (error) return <StatusMessage type="error">{error}</StatusMessage>;
  if (!stats) return <PageLoader label="Loading dashboard..." />;

  const firstName = user?.name?.split(' ')?.[0] || 'Shane';
  const isAdminDashboard = stats.dashboard_mode === 'admin';
  const firmSummary = {
    firms: 0,
    active_firms: 0,
    applications: 0,
    amount_due: 0,
    pending_document_requests: 0,
    uploaded_documents: 0,
    ...(stats.firm_summary || {})
  };
  const firmRows = stats.firm_rows || [];
  const setupTemplates = stats.setupTemplates || [];
  const totalApplications = Number(stats.totalDocuments || 0) + Number(stats.totalTemplates || 0);
  const aiFlags = Math.max(Number(stats.templatesNeedingSetup || 0), setupTemplates.length);
  const monthlyApplications = stats.monthly_applications?.length ? stats.monthly_applications : [];
  const chartMonths = isAdminDashboard
    ? monthlyApplications.map((item) => item.month)
    : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
  const chartValues = isAdminDashboard
    ? monthlyApplications.map((item) => item.applications)
    : [18, 24, 21, 34, 31, 42, Math.max(45, totalApplications + 32)];
  const rawChartMax = Math.max(...chartValues, 0);
  const chartMax = isAdminDashboard
    ? Math.max(5, Math.ceil(rawChartMax / 5) * 5)
    : Math.max(10, Math.ceil(rawChartMax / 10) * 10);
  const chartWidth = 720;
  const chartHeight = 230;
  const chartPadding = { top: 30, right: 34, bottom: 34, left: 40 };
  const chartMidLabel = Math.ceil(chartMax / 2);
  const chartInnerWidth = chartWidth - chartPadding.left - chartPadding.right;
  const chartInnerHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const chartPoints = chartValues.map((value, index) => {
    const x = chartPadding.left + (index / (chartValues.length - 1)) * chartInnerWidth;
    const y = chartPadding.top + (1 - value / chartMax) * chartInnerHeight;
    return { x, y, value, month: chartMonths[index] };
  });
  const chartLine = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const chartCurve = chartPoints.map((point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = chartPoints[index - 1];
    const controlOffset = (point.x - previous.x) / 2;
    return `C ${previous.x + controlOffset} ${previous.y}, ${point.x - controlOffset} ${point.y}, ${point.x} ${point.y}`;
  }).join(' ');
  const chartFill = `${chartCurve} L ${chartPoints.at(-1).x} ${chartHeight - chartPadding.bottom} L ${chartPoints[0].x} ${chartHeight - chartPadding.bottom} Z`;
  const firmTones = ['blue', 'green', 'amber', 'rose'];
  const highlightedPoint = chartPoints.at(-1);
  const tooltipX = highlightedPoint ? Math.min(chartWidth - 120, Math.max(44, highlightedPoint.x - 54)) : 0;
  const tooltipY = highlightedPoint ? Math.max(18, highlightedPoint.y - 46) : 0;

  return (
    <section className="dashboard-page">
      <div className="dashboard-hero">
        <div>
          <h2>{isAdminDashboard ? `Hello, ${firstName}` : `Hello, ${firstName}`}</h2>
          <p>
            {isAdminDashboard
              ? 'Manage law firms, RAF applications, billing, and document activity across the admin workspace.'
              : 'Monitor RAF claim applications, document readiness, and review activity from one secure workspace.'}
          </p>
        </div>
        <div className="dashboard-actions">
          {!isAdminDashboard && (
            <>
              <button className="secondary-button month-filter" type="button"><CalendarDays size={17} /> This Month</button>
              <button className="primary-button" type="button"><Download size={17} /> Download</button>
            </>
          )}
        </div>
      </div>

      <div className="metrics-grid">
        {isAdminDashboard ? (
          <>
            <Metric icon={<Building2 size={22} />} label="Law firms" value={firmSummary.firms} update={`${firmSummary.active_firms} active firms`} />
            <Metric icon={<Scale size={22} />} label="Applications" value={firmSummary.applications} update="Billable RAF cases across firms" />
            <Metric icon={<Banknote size={22} />} label="Amount due" value={currencyFormatter.format(firmSummary.amount_due)} update={`${currencyFormatter.format(stats.rate_per_application)} per application`} />
            <Metric icon={<FileCheck2 size={22} />} label="Pending docs" value={firmSummary.pending_document_requests} update={`${firmSummary.uploaded_documents} uploaded documents`} />
          </>
        ) : (
          <>
            <Metric icon={<Scale size={22} />} label="Total applications" value={totalApplications} update="Last update 2h ago" />
            <Metric icon={<FileText size={22} />} label="Pending documents" value={stats.templatesNeedingSetup} update="Last update 4h ago" />
            <Metric icon={<FileCheck2 size={22} />} label="Ready to review" value={stats.totalDocuments} update="Last update today" />
            <Metric icon={<AlertTriangle size={22} />} label="AI flags" value={aiFlags} update="Last update 18m ago" />
          </>
        )}
      </div>

      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h3>{isAdminDashboard ? 'Application Growth' : 'Claims Activity'}</h3>
              <p>{isAdminDashboard ? 'RAF cases opened across all law firms.' : 'Monthly applications processed through RAFFlow.'}</p>
            </div>
            <span>{isAdminDashboard ? 'Jan - Dec' : '+18.4%'}</span>
          </div>
          <div className="chart-wrap" aria-label="Claims activity line chart">
            <div className="chart-plot" role="img" aria-label={`Applications by month, up to ${chartMax}`}>
              <div className="chart-scale" aria-hidden="true">
                <span>{chartMax}</span>
                <span>{chartMidLabel}</span>
                <span>0</span>
              </div>
              <div className="line-chart">
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Monthly applications line graph">
                  <defs>
                    <linearGradient id="claimGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#1593E7" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#1593E7" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path className="chart-grid" d={`M ${chartPadding.left} ${chartPadding.top} H ${chartWidth - chartPadding.right} M ${chartPadding.left} ${chartPadding.top + chartInnerHeight / 2} H ${chartWidth - chartPadding.right} M ${chartPadding.left} ${chartHeight - chartPadding.bottom} H ${chartWidth - chartPadding.right}`} />
                  <path className="chart-fill" d={chartFill} />
                  <path className="chart-line" d={chartCurve || chartLine} />
                  {chartPoints.map((point) => (
                    <g className="chart-point" key={point.month}>
                      <circle cx={point.x} cy={point.y} r="5" />
                      {!isAdminDashboard && <text x={point.x} y={point.y - 13}>{point.value}</text>}
                    </g>
                  ))}
                  {isAdminDashboard && highlightedPoint && (
                    <g className="chart-tooltip" transform={`translate(${tooltipX} ${tooltipY})`}>
                      <rect width="108" height="34" rx="11" />
                      <text x="54" y="22">{highlightedPoint.value} applications</text>
                    </g>
                  )}
                  {chartPoints.map((point) => (
                    <text className="chart-month-label" x={point.x} y={chartHeight - 8} key={point.month}>{point.month}</text>
                  ))}
                </svg>
              </div>
            </div>
          </div>
        </section>

        <section className="panel firm-billing-panel">
          <div className="panel-header">
            <div>
              <h3>{isAdminDashboard ? 'Top Law Firms' : 'Top Vendors'}</h3>
              <p>{isAdminDashboard ? 'Most active organisations by application volume.' : 'Most active claim partners.'}</p>
            </div>
            {isAdminDashboard ? <Building2 size={18} /> : <Users size={18} />}
          </div>
          <div className="firm-billing-list">
            {isAdminDashboard && firmRows.length === 0 && (
              <p className="muted">No firm billing records yet.</p>
            )}
            {isAdminDashboard && firmRows.slice(0, 6).map((firm, index) => (
              <div className="firm-billing-row" key={firm.firm_id}>
                <span className={`vendor-avatar ${firmTones[index % firmTones.length]}`}>{getFirmInitials(firm.firm_name)}</span>
                <div>
                  <strong>{firm.firm_name}</strong>
                  <small>{firm.contact_email || firm.slug}</small>
                </div>
                <div className="firm-billing-amount">
                  <strong>{firm.applications}</strong>
                  <span>apps</span>
                </div>
                <button className="icon-button firm-row-menu" type="button" title={`More actions for ${firm.firm_name}`} aria-label={`More actions for ${firm.firm_name}`}>
                  <MoreHorizontal size={16} />
                </button>
              </div>
            ))}
            {!isAdminDashboard && (
              <div className="firm-billing-row">
                <span className="vendor-avatar blue"><Users size={17} /></span>
                <div>
                  <strong>Claim partners</strong>
                  <small>Admin analytics are available to admin users.</small>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

    </section>
  );
}
