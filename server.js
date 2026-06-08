const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Apenas arquivos PDF são aceitos.'));
  }
});

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json({ ok: true, configurado: !!ANTHROPIC_API_KEY });
});

app.post('/api/extrair', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ erro: 'Chave de API não configurada no servidor.' });

  try {
    const base64 = req.file.buffer.toString('base64');
    console.log(`Processando: ${req.file.originalname} (${(req.file.size/1024).toFixed(1)} KB)`);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: `Você é um especialista em NFS-e brasileira. Analise o PDF e retorne SOMENTE JSON válido, sem markdown:
{"numero":"","chave_acesso":"","tomador":""}
- numero: número da NFS-e
- chave_acesso: código longo de acesso do documento
- tomador: Nome ou Razão Social do TOMADOR DO SERVIÇO (quem contratou)
Se não encontrar, retorne string vazia.`,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: 'Extraia o número da NFS-e, chave de acesso e nome do TOMADOR DO SERVIÇO. Retorne apenas o JSON.' }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ erro: err?.error?.message || `Erro Anthropic: ${response.status}` });
    }

    const data = await response.json();
    const raw = data.content.map(b => b.text || '').join('').trim();
    const clean = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { return res.status(500).json({ erro: 'Resposta inesperada da IA. Tente novamente.' }); }

    const numero  = (parsed.numero || '').toString().trim();
    const chave   = (parsed.chave_acesso || '').toString().trim();
    const tomador = (parsed.tomador || '').toString().trim();

    if (!numero && !tomador) {
      return res.status(422).json({ erro: 'Dados de NFS-e não encontrados. Verifique se é uma nota fiscal de serviços válida.' });
    }

    const safe = str => str
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s\-]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 100);

    const novoNome = `NFS-e_${safe(numero) || 'SN'}_${safe(tomador) || 'SemTomador'}.pdf`;
    console.log(`OK: ${novoNome}`);

    res.json({ numero, chave, tomador, novoNome });

  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ erro: err.message || 'Erro interno.' });
  }
});

app.use((err, req, res, next) => {
  res.status(400).json({ erro: err.message });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`API Key: ${ANTHROPIC_API_KEY ? 'configurada' : 'NAO configurada'}`);
});
