import puppeteer, { type Browser } from 'puppeteer';

let browser: Browser | null = null;
let launching = false;
const launchQueue: Array<(b: Browser) => void> = [];

async function getBrowser(): Promise<Browser> {
	if (browser && browser.connected) return browser;

	// If the old browser is disconnected, clear it
	if (browser && !browser.connected) {
		browser = null;
	}

	if (launching) {
		return new Promise((resolve) => launchQueue.push(resolve));
	}

	launching = true;
	browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
	});

	// Clean up on browser disconnect
	browser.on('disconnected', () => {
		browser = null;
		launching = false;
	});

	for (const resolve of launchQueue.splice(0)) {
		resolve(browser);
	}
	launching = false;

	return browser;
}

const MAX_RETRIES = 2;

/**
 * Take a screenshot of the `.wrapper` element once.
 * Throws on any failure so the caller can retry.
 */
async function tryScreenshot(url: string): Promise<Buffer> {
	const b = await getBrowser();
	const page = await b.newPage();

	try {
		// Set a wide enough viewport at 4× for large, high-res output
		await page.setViewport({ width: 600, height: 1600, deviceScaleFactor: 4 });

		// All external Discord CDN images are pre-downloaded and served via local
		// proxy URLs by the render endpoint, so the page only loads local resources.
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });

		// Wait until the discord-messages custom element is defined and rendered
		await page.waitForFunction(() => customElements.get('discord-messages') !== undefined, {
			timeout: 10_000
		});

		// Give web components a tick to create their <img> / <video> DOM nodes
		await new Promise((r) => setTimeout(r, 500));

		// Wait for every <img> to finish loading / fail (with a per-image timeout)
		await page.evaluate(() => {
			function collectImages(root: Document | ShadowRoot): HTMLImageElement[] {
				const imgs = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];
				const shadowImgs = Array.from(root.querySelectorAll('*'))
					.filter((el) => el.shadowRoot)
					.flatMap((el) => collectImages(el.shadowRoot!));
				return [...imgs, ...shadowImgs];
			}
			const allImgs = collectImages(document);
			return Promise.all(
				allImgs.map((img) => {
					if (img.complete) return Promise.resolve();
					return new Promise<void>((resolve) => {
						const timer = setTimeout(resolve, 8_000); // don't wait forever per image
						img.onload = () => { clearTimeout(timer); resolve(); };
						img.onerror = () => { clearTimeout(timer); resolve(); };
					});
				})
			);
		});

		// Give layout a final settle tick
		await new Promise((r) => setTimeout(r, 150));

		const el = await page.$('.wrapper');
		if (!el) {
			throw new Error('wrapper element not found on render page');
		}

		const buffer = await el.screenshot({ type: 'png' });
		return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
	} finally {
		try {
			await page.close();
		} catch {
			// Browser may have crashed / disconnected — nothing to close
		}
	}
}

/**
 * Screenshot a discord-messages element at the given URL.
 * Returns the PNG as a Buffer.
 * Retries up to MAX_RETRIES times on transient failures (timeouts, crashes).
 */
export async function screenshot(url: string): Promise<Buffer> {
	let lastError: unknown;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			return await tryScreenshot(url);
		} catch (err) {
			lastError = err;
			const label = `[screenshotter] attempt ${attempt + 1}/${MAX_RETRIES + 1} failed`;
			console.warn(label, err instanceof Error ? err.message : err);

			// If the browser died, force a fresh instance on next attempt
			if (browser && !browser.connected) {
				browser = null;
			}
		}
	}

	throw lastError;
}
