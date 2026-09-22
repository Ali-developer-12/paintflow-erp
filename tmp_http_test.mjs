const base = 'http://localhost:3001';

async function api(path, method, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, text };
}

const login = await api('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' });
console.log('LOGIN', login.status, login.text);
const token = JSON.parse(login.text).token;
const production = await api('/api/productions', 'POST', { particular_id: 5, batch_quantity: 1, remarks: 'Phase 8 QA' }, token);
console.log('PRODUCTION', production.status, production.text);
