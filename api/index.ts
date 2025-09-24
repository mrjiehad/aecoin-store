import { handle } from '@hono/node-server/vercel'
import app from '../src/index'
import { Hono } from 'hono';
export default handle(app)