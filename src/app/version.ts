declare const __APP_VERSION__: string;

/** Injected by Vite at build time from package.json. */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
