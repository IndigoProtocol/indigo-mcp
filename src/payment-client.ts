/**
 * x402 client-side auto-payment wrapper
 *
 * When X402_PRIVATE_KEY is set, intercepts 402 responses from withX402-gated
 * tool handlers, signs a payment, and retries — so callers (e.g. Claude Code)
 * receive the actual tool result rather than a payment-required error.
 *
 * If X402_PRIVATE_KEY is not set, this is a no-op passthrough.
 *
 * PAYMENT_SERVER overrides the facilitator URL at startup (before configure()
 * is called in payment.ts); at runtime it has no effect here because the
 * signing is purely local — the server-side withX402 middleware calls the
 * facilitator for verification.
 */

import { appendFileSync } from 'node:fs';
import { signPayment, buildPaymentPayload, parsePaymentRequired } from '@qbtlabs/x402';

type ToolResult = { content: Array<{ type: string; text: string }> };
type AnyHandler = (params: Record<string, unknown>) => Promise<ToolResult>;

const LOG_FILE = process.env.X402_LOG_FILE ?? '/tmp/indigo-mcp-x402.log';

function log(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}\n`;
  process.stderr.write(line);
  try { appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
}

/**
 * Wraps a tool handler so that 402 responses are automatically paid using
 * the configured X402_PRIVATE_KEY.
 */
export function withAutoPayment(handler: AnyHandler): AnyHandler {
  const privateKey = process.env.X402_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) return handler;

  return async (params: Record<string, unknown>) => {
    const result = await handler(params);

    const text = result?.content?.[0]?.text;
    if (!text) return result;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      return result;
    }

    if (parsed['code'] !== 402) return result;

    const requirements = parsePaymentRequired(
      parsed as Parameters<typeof parsePaymentRequired>[0],
    );
    if (!requirements) return result;

    const signed = await signPayment({
      privateKey,
      to: requirements.payTo as `0x${string}`,
      amount: requirements.price,
      chainId: requirements.chainId,
    });

    const paymentSignature = buildPaymentPayload(signed);

    log(`[x402] paying $${requirements.price} USDC → ${requirements.payTo} (chain ${requirements.chainId}) from ${signed.from}`);

    const finalResult = await handler({ ...params, paymentSignature });

    const finalText = finalResult?.content?.[0]?.text ?? '';
    let finalParsed: Record<string, unknown> = {};
    try { finalParsed = JSON.parse(finalText); } catch { /* not JSON */ }

    if (finalParsed['code'] === 402) {
      log(`[x402] payment verification failed: ${finalParsed['reason'] ?? finalText}`);
    } else {
      log(`[x402] payment accepted — tool executed successfully`);
    }

    return finalResult;
  };
}
