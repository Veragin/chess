/// <reference types="vite-plugin-pwa/vanillajs" />
// Declares the `virtual:pwa-register` module that vite-plugin-pwa generates at build time.
// Only the vanilla entry point is referenced: the React helper (`virtual:pwa-register/react`)
// is not used, and pulling in `vite-plugin-pwa/client` would drag in the Vue/Svelte/Solid shims.
