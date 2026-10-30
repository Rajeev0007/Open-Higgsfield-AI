// Serves images created by the free Cloudflare model from Netlify Blobs.
// Public on purpose: Airtable must be able to download the file for the
// library attachment. Keys are long random strings, so they can't be guessed.
const { blobStore } = require('./_cloudflare')

const KEY_PATTERN = /^\d+-[a-f0-9]{24}\.(jpg|png|webp)$/

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return { statusCode: 405, body: 'Method not allowed' }
  }
  const key = String(event.queryStringParameters?.key || '')
  if (!KEY_PATTERN.test(key)) return { statusCode: 400, body: 'Invalid key' }

  try {
    const entry = await blobStore(event).getWithMetadata(key, { type: 'arrayBuffer' })
    if (!entry || !entry.data) return { statusCode: 404, body: 'Not found' }
    return {
      statusCode: 200,
      headers: {
        'Content-Type': entry.metadata?.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: Buffer.from(entry.data).toString('base64'),
      isBase64Encoded: true,
    }
  } catch (error) {
    console.error('[free-media]', error.message)
    return { statusCode: 500, body: 'Could not load image' }
  }
}
