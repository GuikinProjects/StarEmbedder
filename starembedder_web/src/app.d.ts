// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

// Allow deep import of @skyra/discord-components-core internals used to register
// custom clan icon URLs in the icons map (workaround for the clanIcon === 'string' bug).
declare module '@skyra/discord-components-core/dist/config.js' {
	import type { TemplateResult } from 'lit';
	export const icons: Map<string, TemplateResult | string>;
}

export {};
