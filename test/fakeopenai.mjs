/* Stands in for the model provider so the whole request path can be tested
   without spending anyone's key. Speaks the streaming chat-completions format. */
import http from 'node:http';

const PORT = Number(process.env.PORT || 3112);

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');

  const auth = req.headers.authorization || '';
  if (auth !== 'Bearer test-key') {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
    return;
  }

  // Echo back what the server actually forwarded, so the test can assert on it.
  globalThis.__lastBody = body;
  const seen = JSON.stringify({ roles: body.messages.map(m => m.role), model: body.model });

  res.setHeader('content-type', 'text/event-stream');
  const pieces = ['A funnel counts people, ', 'so use COUNT(DISTINCT user_id). ', 'FORWARDED=' + seen];
  for (const p of pieces) {
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: p } }] }) + '\n\n');
    await new Promise(r => setTimeout(r, 15));
  }
  res.write('data: [DONE]\n\n');
  res.end();
}).listen(PORT, () => console.log('fake provider on http://localhost:' + PORT));
