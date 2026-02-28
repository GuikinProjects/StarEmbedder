import type { RenderPayload } from '$lib/types.js';

const store = new Map<string, RenderPayload>();

/**
 * Store a payload and return the ID to retrieve it.
 * Auto-deletes after 30 seconds.
 */
export function storePayload(payload: RenderPayload): string {
	const id = crypto.randomUUID();
	store.set(id, payload);
	setTimeout(() => store.delete(id), 60_000);
	return id;
}

/**
 * Retrieve a stored payload by ID.
 */
export function getPayload(id: string): RenderPayload | undefined {
	return store.get(id);
}
