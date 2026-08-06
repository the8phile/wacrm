import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] }
    finishReason?: string
  }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  error?: { message?: string; status?: string }
}

/**
 * Gemini's generateContent API uses `user`/`model` roles and, like
 * Anthropic, reads best starting on a customer turn. Reuse the same
 * merge-and-trim normalization, then remap `assistant` -> `model`.
 */
function normalizeForGemini(messages: ChatMessage[]) {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  const turns = merged.length > 0
    ? merged
    : [{ role: 'user' as const, content: '(The customer has not sent a message yet.)' }]
  return turns.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
}

/** Map Gemini's non-2xx response to a typed AiError, same taxonomy the
 *  OpenAI/Anthropic adapters use so the settings "Test key" button and
 *  auto-reply handoff logic don't need to special-case the provider. */
function geminiHttpError(status: number, body: GeminiResponse | null): AiError {
  const detail = body?.error?.message ?? ''
  const code =
    status === 400 && /API key/i.test(detail)
      ? 'invalid_key'
      : status === 401 || status === 403
        ? 'invalid_key'
        : status === 429
          ? 'rate_limited'
          : 'provider_error'
  const base =
    code === 'invalid_key'
      ? 'Google AI Studio rejected the API key'
      : code === 'rate_limited'
        ? 'Google AI Studio rate limit reached'
        : `Google AI Studio API error (${status})`
  return new AiError(detail ? `${base}: ${detail}` : base, {
    code,
    status: code === 'invalid_key' ? 401 : 502,
  })
}

/**
 * Call Google AI Studio's Gemini generateContent endpoint with the
 * caller's own (free-tier) API key. Returns raw assistant text + token
 * usage; handoff-sentinel parsing happens in `generateReply`.
 */
export async function generateGemini(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: normalizeForGemini(messages),
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  const data = (await res.json().catch(() => null)) as GeminiResponse | null

  if (!res.ok) {
    throw geminiHttpError(res.status, data)
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim()

  if (!text) {
    throw new AiError('Gemini returned an empty response.', { code: 'empty_response' })
  }

  const usage = normalizeUsage({
    prompt: data?.usageMetadata?.promptTokenCount,
    completion: data?.usageMetadata?.candidatesTokenCount,
    total: data?.usageMetadata?.totalTokenCount,
  })

  return { text, usage }
}
