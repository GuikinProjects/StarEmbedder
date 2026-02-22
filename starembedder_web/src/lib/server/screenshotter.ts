import puppeteer, { type Browser } from 'puppeteer';

let browser: Browser | null = null;
let launching = false;
const launchQueue: Array<(b: Browser) => void> = [];

async function getBrowser(): Promise<Browser> {
	if (browser) return browser;

	if (launching) {
		return new Promise((resolve) => launchQueue.push(resolve));
	}

	launching = true;
	browser = await puppeteer.launch({
		headless: true,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--disable-gpu'
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
 * Screenshot a discord-messages element at the given URL.
 * Returns the PNG as a Buffer.
 */
export async function screenshot(url: string): Promise<Buffer> {
	const b = await getBrowser();
	const page = await b.newPage();

	try {
		// Set a wide enough viewport at 4× for large, high-res output
		await page.setViewport({ width: 600, height: 1600, deviceScaleFactor: 4 });

		await page.goto(url, { waitUntil: 'networkidle0', timeout: 15_000 });

		// Wait until the discord-messages custom element is defined and rendered
		await page.waitForFunction(
			() => customElements.get('discord-messages') !== undefined,
			{ timeout: 10_000 }
		);

		// Give web components a tick to create their <img> / <video> DOM nodes
		await new Promise((r) => setTimeout(r, 500));

		// Wait for every <img> to finish loading / fail
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
						img.onload = () => resolve();
						img.onerror = () => resolve();
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
		await page.close();
	}
}
