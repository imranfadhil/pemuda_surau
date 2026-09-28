const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

let tokenGetter = () => null;
export function setTokenGetter(fn) {
  tokenGetter = fn;
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = auth ? tokenGetter() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const message = data?.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    // Machine-readable hint from the server (e.g. REGISTRATION_TOO_FAR).
    err.code = data?.code;
    err.retryAfterMinutes = data?.retryAfterMinutes;
    throw err;
  }
  return data;
}

export const api = {
  loginOptions: () => request('/auth/login-options', { auth: false }),
  requestOtp: (phone) => request('/auth/request-otp', { method: 'POST', body: { phone }, auth: false }),
  verifyOtp: (phone, code, location = {}) =>
    request('/auth/verify-otp', {
      method: 'POST',
      body: { phone, code, latitude: location.latitude, longitude: location.longitude },
      auth: false,
    }),
  me: () => request('/auth/me'),

  updateProfile: (profile) => request('/users/me', { method: 'PUT', body: profile }),
  enrollFace: (descriptor) => request('/users/me/face', { method: 'POST', body: { descriptor } }),
  listDependents: () => request('/users/me/dependents'),
  createDependent: (dependent) => request('/users/me/dependents', { method: 'POST', body: dependent }),
  updateDependent: (id, dependent) => request(`/users/me/dependents/${id}`, { method: 'PUT', body: dependent }),
  enrollDependentFace: (id, descriptor) =>
    request(`/users/me/dependents/${id}/face`, { method: 'POST', body: { descriptor } }),
  setDependentPhone: (id, phone) =>
    request(`/users/me/dependents/${id}/phone`, { method: 'POST', body: { phone } }),
  deleteDependent: (id) => request(`/users/me/dependents/${id}`, { method: 'DELETE' }),
  listUsers: () => request('/users'),
  setUserActive: (id, isActive) => request(`/users/${id}/active`, { method: 'PATCH', body: { isActive } }),
  setUserRole: (id, role) => request(`/users/${id}/role`, { method: 'PATCH', body: { role } }),
  generateLoginCode: (id) => request(`/users/${id}/login-code`, { method: 'POST' }),

  telegramLinkToken: () => request('/telegram/link-token', { method: 'POST' }),
  telegramUnlink: () => request('/telegram/link', { method: 'DELETE' }),
  telegramStatus: () => request('/telegram/status'),

  checkIn: (payload) => request('/attendance/check-in', { method: 'POST', body: payload }),
  identify: (payload) => request('/attendance/identify', { method: 'POST', body: payload }),
  currentWindow: () => request('/attendance/current'),
  myAttendance: (limit = 60) => request(`/attendance/me?limit=${limit}`),
  myToday: () => request('/attendance/me/today'),
  familyToday: () => request('/attendance/family/today'),
  familyAttendance: (limit = 60) => request(`/attendance/family?limit=${limit}`),
  manualCheckIn: (payload) => request('/attendance/manual', { method: 'POST', body: payload }),
  attendanceByDate: (date) => request(`/attendance/date/${date}`),

  stats: () => request('/dashboard/stats'),
  weekly: () => request('/dashboard/weekly'),
  leaderboard: (period = 'all', category = 'overall') =>
    request(`/dashboard/leaderboard?period=${period}&category=${category}`),
  myBreakdown: () => request('/dashboard/me/breakdown'),

  myMerits: () => request('/activity/merits/me'),
  listMerits: () => request('/activity/merits'),
  awardMerit: (payload) => request('/activity/merits', { method: 'POST', body: payload }),
  deleteMerit: (id) => request(`/activity/merits/${id}`, { method: 'DELETE' }),

  myQuran: () => request('/activity/quran/me'),
  listQuran: () => request('/activity/quran'),
  logQuran: (payload) => request('/activity/quran', { method: 'POST', body: payload }),
  deleteQuran: (id) => request(`/activity/quran/${id}`, { method: 'DELETE' }),

  listPrograms: (includePast = false) => request(`/programs?includePast=${includePast}`),
  createProgram: (program) => request('/programs', { method: 'POST', body: program }),
  updateProgram: (id, program) => request(`/programs/${id}`, { method: 'PUT', body: program }),
  deleteProgram: (id) => request(`/programs/${id}`, { method: 'DELETE' }),
  joinProgram: (id) => request(`/programs/${id}/join`, { method: 'POST' }),
  leaveProgram: (id) => request(`/programs/${id}/join`, { method: 'DELETE' }),
};
