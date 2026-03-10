import puppeteer, { type Browser, type Page } from 'puppeteer';

let browser: Browser | null = null;
let launching = false;
const launchQueue: Array<(b: Browser) => void> = [];

/** How long (ms) a single attempt may take before we hard-abort it. */
const ATTEMPT_TIMEOUT = 30_000;

/** Puppeteer CDP-level protocol timeout. */
const PROTOCOL_TIMEOUT = 25_000;

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
		protocolTimeout: PROTOCOL_TIMEOUT,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--disable-gpu',
			'--single-process',
			'--no-zygote'
		]
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

/**
 * Forcefully close the shared browser so the next call to getBrowser() spawns
 * a fresh Chromium process. Swallows errors — the old process may already be dead.
 */
async function killBrowser(): Promise<void> {
	const b = browser;
	browser = null;
	launching = false;
	if (b) {
		try {
			await b.close();
		} catch {
			// may already be dead
			try {
				b.process()?.kill('SIGKILL');
			} catch { /* */ }
		}
	}
}

/**
 * Close all pages on the browser except the built-in blank tab.
 * Useful for cleaning up leaked pages from failed attempts.
 */
async function closeAllPages(b: Browser): Promise<void> {
	try {
		const pages = await b.pages();
		await Promise.allSettled(pages.map((p) => p.close().catch(() => { })));
	} catch { /* browser may be dead */ }
}

const MAX_RETRIES = 2;

/**
 * Race a promise against a hard timeout. Rejects with a clear message on timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label}: hard timeout after ${ms}ms`)), ms);
		promise.then(
			(v) => { clearTimeout(timer); resolve(v); },
			(e) => { clearTimeout(timer); reject(e); }
		);
	});
}

/**
 * Take a screenshot of the `.wrapper` element once.
 * Throws on any failure so the caller can retry.
 */
async function tryScreenshot(url: string): Promise<Buffer> {
	const b = await getBrowser();
	let page: Page | null = null;

	try {
		page = await b.newPage();

		// Set page-level default timeouts so no operation hangs forever
		page.setDefaultTimeout(15_000);
		page.setDefaultNavigationTimeout(15_000);

		// Set a wide enough viewport at 4× for large, high-res output
		await page.setViewport({ width: 600, height: 1600, deviceScaleFactor: 4 });

		// All external Discord CDN images are pre-downloaded and served via local
		// proxy URLs by the render endpoint, so the page only loads local resources.
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });

		// Wait until the discord-messages custom element is defined and rendered
		await page.waitForFunction(() => customElements.get('discord-messages') !== undefined, {
			timeout: 15_000
		});

		// Wait for all fonts (including the 11MB emoji font) to finish loading
		await page.evaluate(() => document.fonts.ready);

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
		if (page) {
			try {
				await page.close();
			} catch {
				// Browser may have crashed / disconnected — nothing to close
			}
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
			// Wrap the entire attempt in a hard timeout to prevent hanging forever
			return await withTimeout(
				tryScreenshot(url),
				ATTEMPT_TIMEOUT,
				`[screenshotter] attempt ${attempt + 1}`
			);
		} catch (err) {
			lastError = err;
			const label = `[screenshotter] attempt ${attempt + 1}/${MAX_RETRIES + 1} failed`;
			console.warn(label, err instanceof Error ? err.message : err);

			// On any failure, kill the browser and start fresh next attempt.
			// A browser that survived a timeout / frame-detach is often in a
			// degraded state (leaked pages, high memory) and will keep failing.
			await killBrowser();
		}
	}

	throw lastError;
}
