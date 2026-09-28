import * as automation from '../../lib/services/automation.js';
import { handler, parseBody, mapAutomationBody } from '../../lib/http.js';

export default handler(['POST'], async (req, res) => {
  const status = await automation.updateConfig(mapAutomationBody(parseBody(req)));
  res.json(status);
});
