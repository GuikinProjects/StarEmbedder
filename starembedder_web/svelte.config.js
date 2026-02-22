import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// PORT / HOST / ORIGIN are read from environment variables at runtime.
		// Set PORT in starembedder_web/.env (default: 3000).
		adapter: adapter({
			envPrefix: '' // use PORT, HOST, ORIGIN directly (no prefix)
		})
	}
};

export default config;
