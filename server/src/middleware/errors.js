export function notFound(req, res) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  console.error('[error]', err);
  const status = err.status || 500;
  const body = {
    error: err.expose ? err.message : 'Internal server error',
  };
  // Optional machine-readable code so the client can react (e.g. ask for
  // location during registration, or show a cooldown countdown).
  if (err.code) body.code = err.code;
  if (err.retryAfterMinutes) body.retryAfterMinutes = err.retryAfterMinutes;
  res.status(status).json(body);
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}
