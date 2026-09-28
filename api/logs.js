import { logger } from '../lib/logger.js';
import { handler } from '../lib/http.js';

export default handler(['GET'], async (req, res) => {
  const limit = Math.min(parseInt(req.query?.limit || '200', 10), 500);
  const logs = await logger.list(limit);
  res.json({ logs });
});
