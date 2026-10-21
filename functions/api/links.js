// Public link list for index.html, served from KV (see functions/admin/api.js).
import { readLinks } from '../admin/api.js';

export async function onRequestGet({ request, env }) {
    return Response.json(await readLinks(env, request));
}
