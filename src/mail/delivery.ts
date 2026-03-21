import { getInboxByAddress, storeMessage } from "../db/mail";
import { getDiscordClient } from "../bot";
import { EmbedBuilder } from "discord.js";

const DOMAIN = "basilisk.services";

/**
 * Extract URLs from text.
 */
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>\[\]"'`,;)}\]]+/gi;
  return [...new Set(text.match(urlRegex) || [])];
}

/**
 * Extract OTP/verification codes from text.
 * Matches common patterns: 4-8 digit codes, alphanumeric codes.
 */
function extractCodes(text: string): string[] {
  const codes: string[] = [];

  // "code is 123456" / "code: 123456" / "verification code 123456"
  const codePatterns = [
    /(?:code|pin|otp|token)\s*(?:is|:)\s*(\d{4,8})/gi,
    /(?:verification|confirm|security|auth)\s+code\s*(?:is|:)?\s*(\d{4,8})/gi,
    /(\d{4,8})\s+(?:is your|is the)\s+(?:code|pin|otp)/gi,
    /\b([A-Z0-9]{6,8})\b(?=.*(?:code|verify|confirm|activate))/gi,
  ];

  for (const pattern of codePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1] && !codes.includes(match[1])) {
        codes.push(match[1]);
      }
    }
  }

  return codes;
}

/**
 * Format the email body for Discord DM.
 * Optimized for activation emails and OTP codes:
 * - Extracts and highlights URLs
 * - Extracts and highlights verification codes
 * - Keeps the message clean and scannable
 */
function formatDmMessage(
  recipient: string,
  from: string,
  subject: string,
  bodyText: string
): { content: string; embed: EmbedBuilder } {
  const urls = extractUrls(bodyText);
  const codes = extractCodes(bodyText);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(subject || "(no subject)")
    .setFooter({ text: `${recipient}@${DOMAIN}` })
    .setTimestamp();

  embed.addFields({ name: "From", value: `\`${from}\``, inline: true });

  // Add extracted codes prominently
  if (codes.length > 0) {
    embed.addFields({
      name: "Verification Code",
      value: codes.map((c) => `**\`${c}\`**`).join("  "),
      inline: true,
    });
  }

  // Add extracted URLs
  if (urls.length > 0) {
    const urlList = urls
      .slice(0, 5) // cap at 5 URLs to avoid spam
      .map((u) => u.length > 200 ? u.slice(0, 200) + "..." : u)
      .join("\n");
    embed.addFields({
      name: urls.length === 1 ? "Link" : "Links",
      value: urlList,
    });
  }

  // Clean body text for display
  let body = bodyText.trim();

  // Collapse excessive whitespace
  body = body.replace(/\n{3,}/g, "\n\n");
  body = body.replace(/[ \t]+/g, " ");

  // Truncate for Discord (embed description limit is 4096,
  // but we use content for the body)
  if (body.length > 1500) {
    body = body.slice(0, 1500) + "\n... (truncated)";
  }

  // If body is very short or just a code, don't bother with code block
  const content = body.length > 0 && body !== "(empty)"
    ? `\`\`\`\n${body}\n\`\`\``
    : "";

  return { content, embed };
}

/**
 * Handle an incoming email delivery from the Postfix pipe transport.
 * Expected JSON body:
 * {
 *   recipient: "alice"  (local part only)
 *   from: "sender@example.com"
 *   subject: "Hello"
 *   body_text: "plain text body"
 *   body_html: "<html>...</html>" | null
 *   raw_headers: "From: ...\nTo: ..." | null
 * }
 */
export async function handleMailDelivery(req: Request): Promise<Response> {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { recipient, from, subject, body_text, body_html, raw_headers } =
    payload;

  if (!recipient || !from || !subject || body_text === undefined) {
    return Response.json(
      { error: "Missing required fields: recipient, from, subject, body_text" },
      { status: 400 }
    );
  }

  // Look up the inbox
  const inbox = await getInboxByAddress(recipient);
  if (!inbox) {
    console.log(`[ussymail] No active inbox for recipient: ${recipient}`);
    return Response.json({ error: "No such inbox" }, { status: 404 });
  }

  // Store the message
  const messageId = await storeMessage({
    inboxId: inbox.id,
    fromAddress: from,
    subject,
    bodyText: body_text || "(empty)",
    bodyHtml: body_html || null,
    rawHeaders: raw_headers || null,
  });

  console.log(
    `[ussymail] Stored message #${messageId} for ${recipient}@${DOMAIN} from ${from}`
  );

  // Send Discord DM to inbox owner
  const client = getDiscordClient();
  if (!client) {
    console.error("[ussymail] Discord client not available, skipping DM");
    return Response.json({ ok: true, message_id: messageId, dm_sent: false });
  }

  try {
    const user = await client.users.fetch(inbox.discord_id);
    const dm = await user.createDM();

    const { content, embed } = formatDmMessage(
      recipient,
      from,
      subject,
      body_text || "(empty)"
    );

    await dm.send({
      content: content || undefined,
      embeds: [embed],
    });

    console.log(
      `[ussymail] DM sent to ${inbox.discord_id} for message #${messageId}`
    );
    return Response.json({ ok: true, message_id: messageId, dm_sent: true });
  } catch (err) {
    console.error(
      `[ussymail] Failed to send DM to ${inbox.discord_id}:`,
      err
    );
    // Message is still stored, just DM failed (user may have DMs disabled)
    return Response.json({ ok: true, message_id: messageId, dm_sent: false });
  }
}
