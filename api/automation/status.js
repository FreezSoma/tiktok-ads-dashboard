import * as automation from '../../lib/services/automation.js';
import { handler } from '../../lib/http.js';

export default handler(['GET'], async (_req, res) => {
  res.json(await automation.getStatus());
});
