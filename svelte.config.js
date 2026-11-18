import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: true
		}),
		// Content Security Policy (emitted as a <meta> tag with hashes of
		// SvelteKit's inline bootstrap script). frame-ancestors is sent as an
		// HTTP header from firebase.json because it cannot live in a meta tag.
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:', 'https://firebasestorage.googleapis.com'],
				'font-src': ['self', 'data:'],
				'connect-src': [
					'self',
					'https://firestore.googleapis.com',
					'https://firebasestorage.googleapis.com',
					'https://identitytoolkit.googleapis.com',
					'https://securetoken.googleapis.com',
					'https://firebaseinstallations.googleapis.com'
				],
				'frame-src': ['https://*.firebaseapp.com'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self']
			}
		}
	}
};

export default config;
