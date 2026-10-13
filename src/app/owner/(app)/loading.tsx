export default function Loading() {
  return (
    <div className="dash-loading" role="status" aria-label="Loading">
      <span className="dash-loading-bar" />
      <div className="dash-loading-block" />
      <div className="dash-loading-block short" />
    </div>
  );
}
