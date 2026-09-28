import * as automation from '../../lib/services/automation.js';
import { handler, requireConfigured, parseBody, mapAutomationBody } from '../../lib/http.js';

export default handler(['POST'], async (req, res) => {
  if (!requireConfigured(res)) return;
  try {
    const status = await automation.start(mapAutomationBody(parseBody(req)));
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: err.message, code: 'AUTOMATION_START_FAILED' });
  }
});
