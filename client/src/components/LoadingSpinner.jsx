export function LoadingSpinner({ size = 'md', label = 'Loading', className = '' }) {
  return (
    <span
      className={['loading-spinner', `loading-spinner-${size}`, className].filter(Boolean).join(' ')}
      role="status"
      aria-label={label}
    />
  );
}

export function PageLoader({ label = 'Loading...' }) {
  return (
    <div className="loading-panel" role="status" aria-live="polite">
      <LoadingSpinner size="lg" label={label} />
      <span>{label}</span>
    </div>
  );
}

export function ButtonSpinner({ label = 'Working...' }) {
  return (
    <>
      <LoadingSpinner size="sm" label={label} className="button-spinner" />
      <span>{label}</span>
    </>
  );
}
