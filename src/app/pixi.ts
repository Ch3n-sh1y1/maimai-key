import 'pixi.js/unsafe-eval';
import { Application, Container } from 'pixi.js';

let appPromise: Promise<Application> | null = null;

/**
 * One persistent PIXI application shared by all scenes. The menu screens are
 * DOM based; the WebGL canvas is only shown while playing.
 */
export function getPixiApp(): Promise<Application> {
  if (!appPromise) {
    appPromise = (async () => {
      const app = new Application();
      await app.init({
        background: '#05070d',
        resizeTo: window,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(2, window.devicePixelRatio || 1),
        preference: 'webgl',
        powerPreference: 'high-performance',
        autoStart: false,
      });
      app.ticker.stop();
      app.canvas.id = 'pixi-canvas';
      app.canvas.style.display = 'none';
      document.getElementById('gl')?.appendChild(app.canvas);
      return app;
    })();
  }
  return appPromise;
}

export function showCanvas(app: Application, visible: boolean): void {
  app.canvas.style.display = visible ? 'block' : 'none';
  if (visible) app.renderer.resize(window.innerWidth, window.innerHeight);
}

export function newStageRoot(app: Application): Container {
  const root = new Container();
  app.stage.addChild(root);
  return root;
}
