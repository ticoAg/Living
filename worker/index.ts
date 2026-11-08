// Placeholder — the API area replaces this (see /docs/api/).
import { Hono } from 'hono';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();
app.all('/api/*', (c) => c.json({ error: 'not_found', message: '接口不存在' }, 404));
export default app;
