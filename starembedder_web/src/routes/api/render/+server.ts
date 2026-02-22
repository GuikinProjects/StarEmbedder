import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { RenderPayload } from '$lib/types.js';
import { storePayload } from '$lib/server/renderStore.js';
import { screenshot } from '$lib/server/screenshotter.js';

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

	const id = storePayload(payload);

	const origin = url.origin; // e.g. http://localhost:5173
	const renderUrl = `${origin}/render?id=${id}`;

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

// Respond to CORS pre-flight if needed (bot is local, so same host typically)
export const GET = async () => {
	return json({ status: 'ok' });
};
