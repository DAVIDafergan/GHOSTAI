import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const receivedBodies = [];

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'mock-chat-page.html'));
});

app.get('/contenteditable', (req, res) => {
  res.sendFile(path.join(__dirname, 'mock-chat-page-contenteditable.html'));
});

app.post('/chat', (req, res) => {
  receivedBodies.push(req.body);
  // Small delay simulates a real provider's latency, exercising the same
  // "response arrives asynchronously, then gets detokenized" path.
  setTimeout(() => {
    res.json({ reply: `Got your message: ${req.body.message}` });
  }, 100);
});

app.get('/__received', (req, res) => {
  res.json(receivedBodies);
});

const port = Number(process.env.PORT) || 4500;
app.listen(port, () => {
  console.log(`mock provider listening on ${port}`);
});
