const express = require('express');
const app = express();

app.get('/health', (req, res) => res.json({ status: 'ok' }));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`media-service listening on ${port}`));
}

module.exports = { app };
