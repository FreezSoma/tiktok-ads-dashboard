import { listAccounts } from '../lib/services/accounts.js';
import { handler, requireConfigured } from '../lib/http.js';

export default handler(['GET'], async (_req, res) => {
  if (!requireConfigured(res)) return;
  const accounts = await listAccounts();
  res.json({ accounts });
});
