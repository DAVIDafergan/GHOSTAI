import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

const receivedBodies = [];
const receivedUploads = [];

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'mock-chat-page.html'));
});

app.get('/contenteditable', (req, res) => {
  res.sendFile(path.join(__dirname, 'mock-chat-page-contenteditable.html'));
});

app.get('/file-upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'mock-chat-page-file-upload.html'));
});

app.post('/upload', upload.single('file'), (req, res) => {
  receivedUploads.push({ fileName: req.file.originalname, size: req.file.size });
  res.json({ fileName: req.file.originalname, size: req.file.size });
});

app.get('/__received_uploads', (req, res) => {
  res.json(receivedUploads);
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
