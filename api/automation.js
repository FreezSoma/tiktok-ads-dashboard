import * as automation from '../lib/services/automation.js';
import {
  handler,
  requireConfigured,
  parseBody,
  mapAutomationBody,
} from '../lib/http.js';

/**
 * Consolidated automation endpoint (kept as a single serverless function to
 * stay within the Vercel Hobby 12-function limit).
 *
 * Usage:
 *   GET  /api/automation            -> status  (default)
 *   GET  /api/automation?action=status
 *   POST /api/automation?action=config  body: {...}
 *   POST /api/automation?action=start   body: {...}
 *   POST /api/automation?action=stop
 */
export default handler(['GET', 'POST'], async (req, res) => {
  const action = (req.query?.action || (req.method === 'GET' ? 'status' : '')).toString();

  switch (action) {
    case 'status':
      return res.json(await automation.getStatus());

    case 'config':
      return res.json(await automation.updateConfig(mapAutomationBody(parseBody(req))));

    case 'start': {
      if (!requireConfigured(res)) return;
      try {
        return res.json(await automation.start(mapAutomationBody(parseBody(req))));
      } catch (err) {
        return res.status(400).json({ error: err.message, code: 'AUTOMATION_START_FAILED' });
      }
    }

    case 'stop':
      return res.json(await automation.stop());

    default:
      return res.status(400).json({ error: `Unknown automation action: ${action}` });
  }
});
