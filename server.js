/*
  Little Words local/server TTS proxy

  Set these environment variables before starting the server:
    ELEVENLABS_API_KEY   required, never put this in frontend code
    ELEVENLABS_VOICE_ID  required, the voice to use for generated flashcard audio

  Optional ElevenLabs model/settings:
    ELEVENLABS_FALLBACK_VOICE_ID     default: FGY2WhTYpPnrIDTdsKH5
    ELEVENLABS_MODEL_ID              default: eleven_multilingual_v2
    ELEVENLABS_OUTPUT_FORMAT         default: mp3_44100_128
    ELEVENLABS_STABILITY             default: 0.42
    ELEVENLABS_SIMILARITY_BOOST      default: 0.86
    ELEVENLABS_STYLE                 default: 0.65
    ELEVENLABS_USE_SPEAKER_BOOST     default: true

  The defaults favor a cheerful, expressive, child-friendly read while keeping
  enough similarity/stability to make short words sound consistent.
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '';
const ELEVENLABS_FALLBACK_VOICE_ID = process.env.ELEVENLABS_FALLBACK_VOICE_ID || 'FGY2WhTYpPnrIDTdsKH5';
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
const ELEVENLABS_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128';

const VOICE_SETTINGS = {
  stability: Number(process.env.ELEVENLABS_STABILITY || 0.42),
  similarity_boost: Number(process.env.ELEVENLABS_SIMILARITY_BOOST || 0.86),
  style: Number(process.env.ELEVENLABS_STYLE || 0.65),
  use_speaker_boost: String(process.env.ELEVENLABS_USE_SPEAKER_BOOST || 'true') !== 'false',
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, {'Content-Type': 'application/json'}, JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 16_384) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function handleTTS(req, res) {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    return sendJson(res, 503, {error: 'ElevenLabs is not configured on the server'});
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, 400, {error: 'Invalid JSON body'});
  }

  const text = String(payload.text || '').trim().replace(/\s+/g, ' ');
  if (!text) return sendJson(res, 400, {error: 'Missing text'});
  if (text.length > 240) return sendJson(res, 400, {error: 'Text is too long'});

  try {
    const voiceIds = [...new Set([ELEVENLABS_VOICE_ID, ELEVENLABS_FALLBACK_VOICE_ID].filter(Boolean))];
    let lastFailure = null;

    for (const voiceId of voiceIds) {
      const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
      url.searchParams.set('output_format', ELEVENLABS_OUTPUT_FORMAT);

      const eleven = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL_ID,
        voice_settings: VOICE_SETTINGS,
      }),
      });

      if (!eleven.ok) {
        const detail = await eleven.text().catch(() => '');
        lastFailure = {status: eleven.status, detail: detail.slice(0, 400), voiceId};
        continue;
      }

      const audio = Buffer.from(await eleven.arrayBuffer());
      return send(res, 200, {
        'Content-Type': eleven.headers.get('content-type') || 'audio/mpeg',
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-ElevenLabs-Voice-Id': voiceId,
      }, audio);
    }

    return sendJson(res, 502, {error: 'ElevenLabs request failed', ...lastFailure});
  } catch (err) {
    sendJson(res, 502, {error: 'Could not reach ElevenLabs'});
  }
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(requestUrl.pathname === '/' ? '/LittleWords.html' : requestUrl.pathname);
  const file = path.normalize(path.join(ROOT, pathname));

  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, {'Content-Type': 'text/plain; charset=utf-8'}, 'Not found');
  }

  send(res, 200, {'Content-Type': contentType(file)}, fs.readFileSync(file));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {}, '');
  if (req.url && req.url.startsWith('/api/tts')) {
    if (req.method !== 'POST') return sendJson(res, 405, {error: 'Method not allowed'});
    return handleTTS(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, {error: 'Method not allowed'});
  return serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Little Words server running at http://${HOST}:${PORT}/LittleWords.html`);
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    console.log('ElevenLabs env vars are missing; browser SpeechSynthesis fallback will be used.');
  }
});
