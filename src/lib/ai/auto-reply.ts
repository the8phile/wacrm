import { supabaseAdmin } from './admin-client'
import { getPlanLimits } from '@/lib/billing/plan-limits'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { getStockContext } from './stock'
import { getOrderStatusContext } from './order-status'
import { getProductImageContext } from './product-images'
import { getCustomerProfileContext } from './customer-profile'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText, engineSendMedia } from '@/lib/flows/meta-send'
import { engineSendMessengerText, engineSendMessengerMedia } from '@/lib/messenger/send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // A platform-admin suspension (see /admin/accounts/[id]) must stop
    // the AI from replying too, not just block dashboard access — a
    // suspended account's bot shouldn't keep talking to customers.
    const { data: acctStatus } = await db
      .from('accounts')
      .select('suspended, plan')
      .eq('id', accountId)
      .maybeSingle()
    if (acctStatus?.suspended) return

    // Plan-based monthly AI reply cap (see src/lib/billing/plan-limits.ts).
    // Free/Starter plans have a real ceiling; Pro (and trialing accounts,
    // which are provisioned at plan='pro') are unlimited here. Checked
    // before the more expensive per-conversation logic below so a
    // maxed-out account's inbound doesn't waste knowledge-base lookups.
    const planLimits = getPlanLimits(acctStatus?.plan)
    if (planLimits.maxAiRepliesPerMonth !== null) {
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      const { count: repliesThisMonth } = await db
        .from('ai_usage_log')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('mode', 'auto_reply')
        .gte('created_at', monthStart.toISOString())
      if ((repliesThisMonth ?? 0) >= planLimits.maxAiRepliesPerMonth) return
    }

    // Which platform this contact lives on — decides which Send API
    // (and which stored credentials) `sendText`/`sendPhoto` below use.
    // Defaults to 'whatsapp' if somehow unset, matching every row that
    // predates the multi-channel migration.
    const { data: contactChannelRow } = await db
      .from('contacts')
      .select('channel')
      .eq('id', contactId)
      .maybeSingle()
    const channel: 'whatsapp' | 'messenger' = contactChannelRow?.channel === 'messenger' ? 'messenger' : 'whatsapp'

    /** Send the customer-visible text reply on whichever channel this
     *  conversation is on. */
    const sendText = (text: string) =>
      channel === 'messenger'
        ? engineSendMessengerText({ accountId, conversationId, contactId, text, aiGenerated: true })
        : engineSendText({ accountId, userId: configOwnerUserId, conversationId, contactId, text, aiGenerated: true })

    /** Send a product photo on whichever channel this conversation is on. */
    const sendPhoto = (link: string, caption?: string) =>
      channel === 'messenger'
        ? engineSendMessengerMedia({ accountId, conversationId, contactId, kind: 'image', url: link })
        : engineSendMedia({ accountId, userId: configOwnerUserId, conversationId, contactId, kind: 'image', link, caption })


    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    // Live stock status goes first so a low/out-of-stock warning takes
    // priority over general knowledge-base text.
    const stockNote = await getStockContext(db, accountId)
    const knowledgeWithStock = stockNote ? [stockNote, ...knowledge] : knowledge

    // This customer's own order history, so "where is my order?"
    // gets answered from their real deal/stage instead of a guess.
    const orderStatusNote = await getOrderStatusContext(db, accountId, contactId)
    const knowledgeWithOrders = orderStatusNote
      ? [...knowledgeWithStock, orderStatusNote]
      : knowledgeWithStock

    // Tells the model exactly which product names have a photo on
    // file, so it only ever asks to send a real one.
    const productImageNote = await getProductImageContext(db, accountId)
    const knowledgeWithImages = productImageNote
      ? [...knowledgeWithOrders, productImageNote]
      : knowledgeWithOrders

    // Who the model is actually talking to — name + repeat-customer
    // status. Always present (never null), so it always lands last,
    // closest to the live conversation.
    const customerProfileNote = await getCustomerProfileContext(db, accountId, contactId)
    const knowledgeWithProfile = [...knowledgeWithImages, customerProfileNote]

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge: knowledgeWithProfile,
    })

    const { text, handoff, usage, order, images } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      }
      // Only set the assignee when a target is configured AND the thread
      // isn't already owned — never stomp an existing human assignment.
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    await sendText(text)

    // The model reported a completed order (see the [[ORDER ...]]
    // sentinel taught in the system prompt) — log it as a deal on the
    // account's first pipeline so a human can follow up and finalize
    // it. Best-effort: a failure here must not affect the customer's
    // reply, which already sent above.
    if (order) {
      try {
        const { data: pipeline } = await db
          .from('pipelines')
          .select('id, pipeline_stages(id, position)')
          .eq('account_id', accountId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        const stages = (pipeline?.pipeline_stages ?? []) as { id: string; position: number }[]
        const firstStage = stages.sort((a, b) => a.position - b.position)[0]
        const { data: acct } = await db
          .from('accounts')
          .select('default_currency')
          .eq('id', accountId)
          .maybeSingle()

        if (pipeline?.id && firstStage?.id) {
          await db.from('deals').insert({
            account_id: accountId,
            user_id: configOwnerUserId,
            pipeline_id: pipeline.id,
            stage_id: firstStage.id,
            contact_id: contactId,
            title: `AI order: ${order.item}${order.qty > 1 ? ` x${order.qty}` : ''}`,
            value: order.value,
            currency: acct?.default_currency ?? 'USD',
            status: 'open',
          })
        } else {
          console.warn('[ai auto-reply] order detected but account has no pipeline/stage to file it in')
        }

        // Messenger has no phone number on the contact record at all
        // (the platform never exposes one via its API) — this is the
        // one natural moment a Messenger customer's real phone number
        // becomes known, since the AI just asked for it to complete
        // the order. Save it so future messages have it on file.
        // WhatsApp contacts already have their real phone as their
        // account identity, so this only applies to Messenger.
        if (order.phone && channel === 'messenger') {
          await db
            .from('contacts')
            .update({ phone: order.phone })
            .eq('id', contactId)
            .is('phone', null)
        }
      } catch (err) {
        console.error('[ai auto-reply] failed to log AI-detected order as a deal:', err)
      }
    }

    // The model asked to send one or more product photos (see the
    // [[SEND_IMAGE ...]] sentinels taught in the system prompt) —
    // look up each account-saved URL and send them one at a time.
    // Best-effort per photo: one failing must not stop the others,
    // and none of this affects the customer's text reply, which
    // already sent above.
    for (const productName of images) {
      try {
        const { data: photo } = await db
          .from('product_images')
          .select('image_url, caption')
          .eq('account_id', accountId)
          .eq('product_name', productName)
          .maybeSingle()

        if (photo?.image_url) {
          await sendPhoto(photo.image_url, photo.caption ?? undefined)
        } else {
          // Shouldn't happen — the model was only given names that
          // exist — but a stale/renamed product is possible.
          console.warn(
            `[ai auto-reply] model asked to send image for unknown product "${productName}"`,
          )
        }
      } catch (err) {
        console.error(`[ai auto-reply] failed to send product image "${productName}":`, err)
      }
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}
