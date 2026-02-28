import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { RenderPayload } from '$lib/types.js';
import { storePayload } from '$lib/server/renderStore.js';
import { screenshot } from '$lib/server/screenshotter.js';

/** Discord CDN URL pattern */
const DISCORD_CDN = /^https?:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\//;

/** In-memory image cache for proxied Discord CDN images. Entries auto-expire after 60s. */
const imageCache = new Map<string, { data: Buffer; contentType: string }>();

/**
 * Pre-download a Discord CDN image and store it in the imageCache.
 * Returns a local proxy URL like `http://<host>/api/render?_img=<key>&_ext=.gif`
 * which the render page uses as the `<img>` src. This avoids:
 *   1. `@skyra/discord-components-core`'s IMAGE_EXTENSION regex rejecting URLs
 *      that end with query params (e.g. `image.gif?ex=...`).
 *   2. Puppeteer being unable to fetch Discord CDN resources.
 *   3. Expired / token-gated URLs returning 404 in Chrome.
 *
 * Returns `null` if the download fails (404, network error) — callers should
 * remove the attachment from the payload.
 */
async function proxyUrl(
	url: string,
	host: string
): Promise<string | null> {
	if (!DISCORD_CDN.test(url)) return url;

	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StarEmbedder/1.0)' }
		});
		if (!res.ok) {
			console.warn(`[render] pre-download failed ${res.status} for ${url}`);
			return null;
		}
		const data = Buffer.from(await res.arrayBuffer());
		const contentType = res.headers.get('content-type') ?? 'application/octet-stream';

		// Derive key from URL path to keep it deterministic
		const key = Buffer.from(url).toString('base64url');
		imageCache.set(key, { data, contentType });
		// Auto-expire after 60s
		setTimeout(() => imageCache.delete(key), 60_000);

		// Build a local URL that ends with the right extension for component validation
		const ext = url.split('?')[0].split('.').pop() ?? 'png';
		return `http://${host}/api/render?_img=${key}&_ext=.${ext}`;
	} catch (err) {
		console.warn('[render] pre-download error:', err instanceof Error ? err.message : err);
		return null;
	}
}

/** Walk every URL field in the payload, replace Discord CDN URLs with local proxies,
 *  and remove any attachments/stickers whose images could not be downloaded. */
async function proxyPayloadUrls(
	payload: RenderPayload,
	host: string
): Promise<void> {
	// Author avatar (keep original URL if proxy fails — avatar is less critical)
	const avatarProxy = await proxyUrl(payload.message.author.avatarUrl, host);
	if (avatarProxy) payload.message.author.avatarUrl = avatarProxy;

	// Role icon URL
	if (payload.message.author.roleIconUrl) {
		const proxy = await proxyUrl(payload.message.author.roleIconUrl, host);
		if (proxy) payload.message.author.roleIconUrl = proxy;
	}

	// Clan icon URL
	if (payload.message.author.clanIconUrl) {
		const proxy = await proxyUrl(payload.message.author.clanIconUrl, host);
		if (proxy) payload.message.author.clanIconUrl = proxy;
	}

	// Attachments — remove any that fail to download
	const proxiedAttachments = await Promise.all(
		payload.message.attachments.map(async (att) => {
			const proxy = await proxyUrl(att.url, host);
			if (!proxy) return null; // image gone, remove attachment
			att.url = proxy;
			return att;
		})
	);
	payload.message.attachments = proxiedAttachments.filter((a): a is NonNullable<typeof a> => a !== null);

	// Stickers — remove any that fail to download
	if (payload.message.stickers) {
		const proxiedStickers = await Promise.all(
			payload.message.stickers.map(async (sticker) => {
				const proxy = await proxyUrl(sticker.url, host);
				if (!proxy) return null;
				sticker.url = proxy;
				return sticker;
			})
		);
		payload.message.stickers = proxiedStickers.filter((s): s is NonNullable<typeof s> => s !== null);
	}

	// Embeds
	for (const embed of payload.message.embeds) {
		if (embed.thumbnail) {
			const proxy = await proxyUrl(embed.thumbnail, host);
			if (proxy) embed.thumbnail = proxy;
			else embed.thumbnail = undefined;
		}
		if (embed.image) {
			const proxy = await proxyUrl(embed.image, host);
			if (proxy) embed.image = proxy;
			else embed.image = undefined;
		}
		if (embed.video) {
			const proxy = await proxyUrl(embed.video, host);
			if (proxy) embed.video = proxy;
			else embed.video = undefined;
		}
		if (embed.author?.iconURL) {
			const proxy = await proxyUrl(embed.author.iconURL, host);
			if (proxy) embed.author.iconURL = proxy;
			else embed.author.iconURL = undefined;
		}
		if (embed.footer?.iconURL) {
			const proxy = await proxyUrl(embed.footer.iconURL, host);
			if (proxy) embed.footer.iconURL = proxy;
			else embed.footer.iconURL = undefined;
		}
	}

	// Reply avatar (keep original URL if proxy fails)
	if (payload.message.reply) {
		const proxy = await proxyUrl(payload.message.reply.avatarUrl, host);
		if (proxy) payload.message.reply.avatarUrl = proxy;
	}
}

export const POST = async ({ request, url }: RequestEvent) => {
	let payload: RenderPayload;

	try {
		payload = (await request.json()) as RenderPayload;
	} catch {
		return error(400, 'Invalid JSON body');
	}

	if (!payload?.message?.id || !payload?.message?.author) {
		return error(400, 'Missing required message fields');
	}

	const host = url.host; // e.g. localhost:27010

	// Pre-download all Discord CDN images and replace URLs with local proxies.
	// This avoids extension-validation failures and expired-token 404s.
	await proxyPayloadUrls(payload, host);

	const id = storePayload(payload);

	// Force HTTP for internal container communication (Puppeteer runs locally on HTTP)
	const renderUrl = `http://${host}/render?id=${id}`;

	try {
		const png = await screenshot(renderUrl);
		return new Response(new Uint8Array(png), {
			headers: {
				'Content-Type': 'image/png',
				'Content-Length': String(png.length)
			}
		});
	} catch (err) {
		console.error('[screenshotter] failed:', err);
		return error(500, 'Screenshot failed');
	}
};

/** Serve a pre-downloaded image from the cache. */
export const GET = async ({ url }: RequestEvent) => {
	const imgKey = url.searchParams.get('_img');
	if (imgKey) {
		const cached = imageCache.get(imgKey);
		if (!cached) {
			return error(404, 'Image not found or expired');
		}
		return new Response(new Uint8Array(cached.data), {
			headers: {
				'Content-Type': cached.contentType,
				'Cache-Control': 'no-store'
			}
		});
	}

	return json({ status: 'ok' });
};
