export function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="statusError" onClick={onDismiss} role="button" tabIndex={0}>
      {message}
    </div>
  );
}
