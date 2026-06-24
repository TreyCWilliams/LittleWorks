/*
  Cloudflare Pages Function for Little Words ElevenLabs TTS.

  Set these in Cloudflare Pages → Settings → Environment variables:
    ELEVENLABS_API_KEY   Secret, required
    ELEVENLABS_VOICE_ID  Secret/plain variable, required

  Optional model/settings:
    ELEVENLABS_FALLBACK_VOICE_ID default: FGY2WhTYpPnrIDTdsKH5
    ELEVENLABS_MODEL_ID          default: eleven_multilingual_v2
    ELEVENLABS_OUTPUT_FORMAT     default: mp3_44100_128
    ELEVENLABS_STABILITY         default: 0.42
    ELEVENLABS_SIMILARITY_BOOST  default: 0.86
    ELEVENLABS_STYLE             default: 0.65
    ELEVENLABS_USE_SPEAKER_BOOST default: true
*/

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.ELEVENLABS_API_KEY || '';
  const primaryVoiceId = env.ELEVENLABS_VOICE_ID || '';
  const fallbackVoiceId = env.ELEVENLABS_FALLBACK_VOICE_ID || 'FGY2WhTYpPnrIDTdsKH5';

  if (!apiKey || !primaryVoiceId) {
    return json({ error: 'ElevenLabs is not configured' }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const text = String(payload.text || '').trim().replace(/\s+/g, ' ');
  if (!text) return json({ error: 'Missing text' }, 400);
  if (text.length > 240) return json({ error: 'Text is too long' }, 400);

  const modelId = env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
  const outputFormat = env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128';
  const voiceSettings = {
    stability: Number(env.ELEVENLABS_STABILITY || 0.42),
    similarity_boost: Number(env.ELEVENLABS_SIMILARITY_BOOST || 0.86),
    style: Number(env.ELEVENLABS_STYLE || 0.65),
    use_speaker_boost: String(env.ELEVENLABS_USE_SPEAKER_BOOST || 'true') !== 'false',
  };

  const voiceIds = [...new Set([primaryVoiceId, fallbackVoiceId].filter(Boolean))];
  let lastFailure = null;

  for (const voiceId of voiceIds) {
    const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
    url.searchParams.set('output_format', outputFormat);

    const eleven = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: voiceSettings,
      }),
    });

    if (!eleven.ok) {
      const detail = await eleven.text().catch(() => '');
      lastFailure = { status: eleven.status, detail: detail.slice(0, 400), voiceId };
      continue;
    }

    return new Response(eleven.body, {
      status: 200,
      headers: {
        'Content-Type': eleven.headers.get('content-type') || 'audio/mpeg',
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-ElevenLabs-Voice-Id': voiceId,
      },
    });
  }

  return json({ error: 'ElevenLabs request failed', ...lastFailure }, 502);
}

export async function onRequestGet(context) {
  return json(ttsConfig(context.env));
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { status: 204 });
  return json({ error: 'Method not allowed' }, 405);
}

function ttsConfig(env) {
  const primaryVoiceId = env.ELEVENLABS_VOICE_ID || '';
  const fallbackVoiceId = env.ELEVENLABS_FALLBACK_VOICE_ID || 'FGY2WhTYpPnrIDTdsKH5';
  const modelId = env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
  const outputFormat = env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128';
  const stability = String(env.ELEVENLABS_STABILITY || 0.42);
  const similarity = String(env.ELEVENLABS_SIMILARITY_BOOST || 0.86);
  const style = String(env.ELEVENLABS_STYLE || 0.65);
  const speakerBoost = String(env.ELEVENLABS_USE_SPEAKER_BOOST || 'true') !== 'false';
  return {
    configured: Boolean(env.ELEVENLABS_API_KEY && primaryVoiceId),
    primaryVoiceId,
    fallbackVoiceId,
    modelId,
    cacheKey: ['elevenlabs-v1', primaryVoiceId, fallbackVoiceId, modelId, outputFormat, stability, similarity, style, speakerBoost].join('|'),
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
