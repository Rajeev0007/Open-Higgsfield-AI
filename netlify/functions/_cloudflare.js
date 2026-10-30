// Free image generation through Cloudflare Workers AI.
// Every Cloudflare account gets a free daily allowance (10,000 neurons, resets
// 00:00 UTC), which covers roughly 100+ FLUX.1 [schnell] images a day at no cost.
// Server-side secrets (Netlify env): CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
// (CF_ACCOUNT_ID / CF_API_TOKEN also accepted). The token needs "Workers AI: Read".
const crypto = require('crypto')

const FREE_IMAGE_MODEL = {
  id: 'cloudflare/flux-1-schnell',
  label: 'FLUX Schnell (Free)',
  provider: 'cloudflare',
  kind: 'image',
  api: 'cloudflare',
  blurb: 'Free text-to-image via Cloudflare Workers AI daily allowance. Square 1024px.',
  aspects: ['1:1'],
  credits: 0,
  pricing: { credits: 0, unit: 'cr/image', runs: 0, usd: 0, source: 'published' },
}

const CF_MODEL = '@cf/black-forest-labs/flux-1-schnell'
const MEDIA_STORE = 'free-media'

function cloudflareConfig() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '').trim()
  const token = String(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || '').trim()
  return accountId && token ? { accountId, token } : null
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

// Returns { buffer, contentType }.
async function generateFreeImage(prompt, { seed } = {}) {
  const config = cloudflareConfig()
  if (!config) throw httpError(503, 'Free image generation is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in Netlify.')

  const input = { prompt: String(prompt).slice(0, 2048), steps: 4 }
  if (Number.isInteger(seed) && seed >= 0) input.seed = seed

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/run/${CF_MODEL}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  const raw = await res.text()
  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch {}

  if (!res.ok || data.success === false) {
    const first = Array.isArray(data.errors) ? data.errors[0] : null
    const code = first?.code
    const message = first?.message || raw.slice(0, 300) || `Cloudflare request failed (${res.status})`
    if (res.status === 429 || code === 4006) {
      throw httpError(429, 'Free daily image limit reached. It resets at 00:00 UTC.')
    }
    throw httpError(res.status >= 400 ? res.status : 502, `Cloudflare Workers AI: ${message}`)
  }

  const image = data.result?.image
  if (!image) throw httpError(502, 'Cloudflare Workers AI returned no image.')
  if (/^https?:\/\//i.test(image)) {
    const download = await fetch(image)
    if (!download.ok) throw httpError(502, 'Could not download the generated image.')
    return {
      buffer: Buffer.from(await download.arrayBuffer()),
      contentType: download.headers.get('content-type') || 'image/jpeg',
    }
  }
  const buffer = Buffer.from(image, 'base64')
  return { buffer, contentType: sniffImageType(buffer) }
}

function sniffImageType(buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png'
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp'
  return 'image/jpeg'
}

function extensionFor(contentType) {
  return ({ 'image/png': 'png', 'image/webp': 'webp' })[contentType] || 'jpg'
}

// Lazily loaded so a missing package never breaks the other functions.
function blobStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs')
  connectLambda(event)
  return getStore(MEDIA_STORE)
}

// Saves the image in Netlify Blobs (free on Netlify) and returns a public URL
// served by the free-media function. Returns null when Blobs is unavailable.
async function storeFreeImage(event, { buffer, contentType }) {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL
  if (!base) return null
  const key = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.${extensionFor(contentType)}`
  try {
    const store = blobStore(event)
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    await store.set(key, bytes, { metadata: { contentType } })
  } catch (error) {
    console.error('[cloudflare] Netlify Blobs write failed', error.message)
    return null
  }
  return { key, url: `${base}/.netlify/functions/free-media?key=${encodeURIComponent(key)}` }
}

module.exports = {
  FREE_IMAGE_MODEL,
  MEDIA_STORE,
  cloudflareConfig,
  generateFreeImage,
  storeFreeImage,
  blobStore,
}
