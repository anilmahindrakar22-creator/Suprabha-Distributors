import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createSyncHandler } from './handler.ts';

Deno.serve(createSyncHandler({ env: name => Deno.env.get(name), fetchFn: fetch }));
