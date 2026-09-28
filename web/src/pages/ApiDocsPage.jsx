import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

// swagger-ui-react is large (~180 packages) and only admins ever open this
// page, so it is code-split: the bundle is fetched on demand, not on app load.
const SwaggerUI = lazy(() => import('swagger-ui-react'));
// The stylesheet is imported dynamically too, so it is not in the main CSS.
import('swagger-ui-react/swagger-ui.css');

/**
 * API reference (admin only).
 *
 * Renders the OpenAPI spec from /openapi.yaml. The route is already wrapped in
 * <AdminOnly>, but we re-check here so the page can never render for a
 * non-admin even if the routing changes.
 *
 * The logged-in JWT is injected automatically, so "Try it out" works without
 * pasting a token by hand.
 */
export default function ApiDocsPage() {
  const { user, token } = useAuth();
  const [spec, setSpec] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/openapi.yaml')
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load the API spec (${res.status}).`);
        return res.text();
      })
      .then(setSpec)
      .catch((err) => setError(err.message));
  }, []);

  // Pre-authorise Swagger UI with the current session token. `requestInterceptor`
  // is the supported hook: it runs on every request Swagger UI makes, so the
  // header is always present and stays correct if the token is refreshed.
  const requestInterceptor = useMemo(
    () => (req) => {
      if (token) {
        req.headers = { ...req.headers, Authorization: `Bearer ${token}` };
      }
      return req;
    },
    [token],
  );

  if (user?.role !== 'admin') {
    return (
      <div>
        <h1 className="page-title">API reference</h1>
        <div className="alert alert-error">Admins only.</div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">API reference</h1>
      <p className="page-sub">
        Every endpoint, its authentication and its payloads. Admin-only — this page is not
        linked from the public navigation.
      </p>

      <div className="alert alert-info">
        You are signed in as <strong>{user?.fullName}</strong>, so requests are sent with your
        token automatically — just expand an endpoint and use <strong>Try it out</strong>. The
        token is attached per request and is never stored by this page.
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!spec && !error && <p className="muted">Loading API spec…</p>}

      {spec && (
        <div className="api-docs">
          <Suspense fallback={<p className="muted">Loading API reference…</p>}>
            <SwaggerUI
              url="/openapi.yaml"
              docExpansion="list"
              defaultModelsExpandDepth={-1}
              tryItOutEnabled
              requestInterceptor={requestInterceptor}
            />
          </Suspense>
        </div>
      )}

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/admin">← Back to Admin</Link>
      </p>
    </div>
  );
}
