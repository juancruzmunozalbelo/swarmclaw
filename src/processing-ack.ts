/**
 * Processing Acknowledgment — sends "processing..." ack to the user.
 * Extracted from index.ts during Sprint 9 decomposition.
 */

import {
    PROCESSING_ACK_ENABLED,
    PROCESSING_ACK_DEBOUNCE_MS,
    PROCESSING_ACK_TEXT,
    ASSISTANT_NAME,
} from './config.js';

// ── State ──────────────────────────────────────────────────────────────────

const lastProcessingAckAt = new Map<string, number>();



// ── Main function ──────────────────────────────────────────────────────────

export interface ProcessingAckDeps {
    sendMessage: (jid: string, text: string) => Promise<void>;
}

export async function maybeSendProcessingAck(
    params: {
        chatJid: string;
        isMainGroup: boolean;
        groupRequiresTrigger: boolean | undefined;
    },
    deps: ProcessingAckDeps,
): Promise<void> {
    const { chatJid, isMainGroup, groupRequiresTrigger } = params;

    const shouldAck =
        PROCESSING_ACK_ENABLED &&
        (isMainGroup || chatJid.endsWith('@s.whatsapp.net') || groupRequiresTrigger === false);
    if (!shouldAck) return;

    const now = Date.now();
    const last = lastProcessingAckAt.get(chatJid) || 0;
    if (now - last < PROCESSING_ACK_DEBOUNCE_MS) return;

    await deps.sendMessage(chatJid, `${ASSISTANT_NAME}: ${PROCESSING_ACK_TEXT}`);
    lastProcessingAckAt.set(chatJid, now);
}
