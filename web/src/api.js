import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
});

export default api;

export const login = (username, password) =>
  api.post('/auth/login', { username, password }).then(r => r.data);

export const getRepairTypes = () =>
  api.get('/repair-types').then(r => r.data);

export const getCostSubjects = () =>
  api.get('/cost-subjects').then(r => r.data);

export const getConstructionTeams = () =>
  api.get('/construction-teams').then(r => r.data);

export const getFundAccounts = () =>
  api.get('/fund-accounts').then(r => r.data);

export const getBudgets = (year) =>
  api.get('/budgets', { params: { year } }).then(r => r.data);

export const checkTenantArrears = (tenantId) =>
  api.get(`/tenants/${tenantId}/check-arrears`).then(r => r.data);

export const getRepairRequests = (params) =>
  api.get('/repair-requests', { params }).then(r => r.data);

export const getRepairRequest = (id) =>
  api.get(`/repair-requests/${id}`).then(r => r.data);

export const createRepairRequest = (data) =>
  api.post('/repair-requests', data).then(r => r.data);

export const updateRepairRequest = (id, data) =>
  api.put(`/repair-requests/${id}`, data).then(r => r.data);

export const approveRepairRequest = (id, data) =>
  api.post(`/repair-requests/${id}/approve`, data).then(r => r.data);

export const addQuotation = (id, data) =>
  api.post(`/repair-requests/${id}/quotations`, data).then(r => r.data);

export const compareQuotations = (id) =>
  api.get(`/repair-requests/${id}/compare-quotations`).then(r => r.data);

export const selectQuotation = (id, quotationId) =>
  api.post(`/repair-requests/${id}/select-quotation`, { quotation_id: quotationId }).then(r => r.data);

export const startConstruction = (id) =>
  api.post(`/repair-requests/${id}/start-construction`).then(r => r.data);

export const completeConstruction = (id) =>
  api.post(`/repair-requests/${id}/complete-construction`).then(r => r.data);

export const acceptRepair = (id, data) =>
  api.post(`/repair-requests/${id}/accept`, data).then(r => r.data);

export const addInvoice = (id, data) =>
  api.post(`/repair-requests/${id}/invoices`, data).then(r => r.data);

export const disburseFund = (id, data) =>
  api.post(`/repair-requests/${id}/disburse`, data).then(r => r.data);

export const reconcileRequest = (id) =>
  api.get(`/repair-requests/${id}/reconcile`).then(r => r.data);

export const getFundLedgers = () =>
  api.get('/fund-ledgers').then(r => r.data);

export const getStats = () =>
  api.get('/stats').then(r => r.data);
