import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	resolve: {
		alias: [
			{
				// Allow deep import of @skyra/discord-components-core internals (icons map)
				find: /^@skyra\/discord-components-core\/dist\/(.*)/,
				replacement: fileURLToPath(
					new URL('./node_modules/@skyra/discord-components-core/dist/$1', import.meta.url)
				)
			}
		]
	},
	server: {
		// Suppress "points to missing source files" warnings from packages that don't ship sources
		sourcemapIgnoreList: (sourcePath) => sourcePath.includes('node_modules')
	},
	build: {
		rollupOptions: {
			onwarn(warning, warn) {
				if (warning.code === 'SOURCEMAP_ERROR' || warning.message.includes('points to missing source files')) return;
				warn(warning);
			}
		}
	}
});
