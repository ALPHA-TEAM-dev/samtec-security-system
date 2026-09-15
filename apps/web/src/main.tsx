import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import { env } from './lib/env';
import './index.css';

/** In mock mode, start the pretend API before the app sends its first request. */
async function startMockApi(): Promise<void> {
  if (!env.useMocks) {
    return;
  }
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('index.html is missing <div id="root">.');
}

await startMockApi();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
