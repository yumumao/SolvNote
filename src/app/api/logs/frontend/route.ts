import { NextRequest } from 'next/server';
import { aiErrorResponse, assertSameOrigin, requireUser } from '@/lib/ai-access';

export const runtime = 'nodejs';

/** Old cached clients may still send diagnostics. Do not parse, retain or echo them. */
export async function POST(request: NextRequest) {
  try {
    await requireUser(request);
    assertSameOrigin(request);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } });
  } catch (error) {
    return aiErrorResponse(error);
  }
}