import { listIdentities } from '../lib/services/identities.js';
import { handler, requireConfigured, getAdvertiserId } from '../lib/http.js';

export default handler(['GET'], async (req, res) => {
  if (!requireConfigured(res)) return;
  const advertiserId = getAdvertiserId(req, res);
  if (!advertiserId) return;
  const identities = await listIdentities(advertiserId);
  res.json({ identities });
});
