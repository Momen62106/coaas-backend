import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import Stripe from 'stripe';
import cron from 'node-cron';

const app = express();
app.use('/billing/webhook', express.raw({ type: 'application/json' }));
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const TIER_PLANS = {
  Essentials: [
    { content_type: 'Blog Post', word_count: 800, funnel_stage: 'Top of funnel' },
    { content_type: 'Blog Post', word_count: 800, funnel_stage: 'Top of funnel' },
    { content_type: 'Social Media Post', word_count: 150, funnel_stage: 'Top of funnel' },
    { content_type: 'Social Media Post', word_count: 150, funnel_stage: 'Top of funnel' },
    { content_type: 'Social Media Post', word_count: 150, funnel_stage: 'Middle of funnel' },
    { content_type: 'Social Media Post', word_count: 150, funnel_stage: 'Middle of funnel' },
  ],
  Growth: [
    { content_type: 'Blog Post', word_count: 1000, funnel_stage: 'Top of funnel' },
    { content_type: 'Blog Post', word_count: 1000, funnel_stage: 'Top of funnel' },
    { content_type: 'Blog Post', word_count: 1000, funnel_stage: 'Middle of funnel' },
    { content_type: 'Blog Post', word_count: 1000, funnel_stage: 'Bottom of funnel' },
    { content_type: 'Email Newsletter', word_count: 400, funnel_stage: 'Middle of funnel' },
    { content_type: 'Email Newsletter', word_count: 400, funnel_stage: 'Bottom of funnel' },
    { content_type: 'Social Media Post', word_count: 150, funnel_stage: 'Top of funnel' },
    { content_type: 'Social Media Post', word_count: 150, funnel_stage: 'Top of funnel' },
    { content_type: 'Social Media Post', word_count: 150, funnel_stage: 'Top of funnel' },
    { content_type: 'Social Media Post', word_count: 150, funnel_stage: 'Middle of funnel' },
    { content_type: 'Social Media Post', word_count: 150, funnel_stage: 'Middle of funnel' },
    { content_type: 'Social Media Post', word_count: 150, funnel_stage: 'Bottom of funnel' },
    { content_type: 'Social Media Post', word_count: 150, funnel_stage: 'Bottom of funnel' },
    { content_type: 'Social Media Post', word_count: 150, funnel_stage: 'Top of funnel' },
  ],
  Pro: [
    { content_type: 'Blog Post', word_count: 1200, funnel_stage: 'Top of funnel' },
    { content_type: 'Blog Post', word_count: 1200, funnel_stage: 'Top of funnel' },
    { content_type: 'Blog Post', word_count: 1200, funnel_stage: 'Top of funnel' },
    { content_type: 'Blog Post', word_count: 1200, funnel_stage: 'Middle of funnel' },
    { content_type: 'Blog Post', word_count: 1200, funnel_stage: 'Middle of funnel' },
    { content_type: 'Blog Post', word_count: 1200, funnel_stage: 'Bottom of funnel' },
    { content_type: 'Blog Post', word_count: 1200, funnel_stage: 'Bottom of funnel' },
    { content_type: 'Blog Post', word_count: 1500, funnel_stage: 'Top of funnel' },
    { content_type: 'Email Newsletter', word_count: 500, funnel_stage: 'Middle of funnel' },
    { content_type: 'Email Newsletter', word_count: 500, funnel_stage: 'Middle of funnel' },
    { content_type: 'Email Newsletter', word_count: 500, funnel_stage: 'Bottom of funnel' },
    { content_type: 'Email Newsletter', word_count: 500, funnel_stage: 'Bottom of funnel' },
    { content_type: 'LinkedIn Post', word_count: 200, funnel_stage: 'Top of funnel' },
    { content_type: 'LinkedIn Post', word_count: 200, funnel_stage: 'Top of funnel' },
    { content_type: 'LinkedIn Post', word_count: 200, funnel_stage: 'Middle of funnel' },
    { content_type: 'LinkedIn Post', word_count: 200, funnel_stage: 'Middle of funnel' },
    { content_type: 'LinkedIn Post', word_count: 200, funnel_stage: 'Bottom of funnel' },
    { content_type: 'LinkedIn Post', word_count: 200, funnel_stage: 'Top of funnel' },
    { content_type: 'LinkedIn Post', word_count: 200, funnel_stage: 'Top of funnel' },
    { content_type: 'LinkedIn Post', word_count: 200, funnel_stage: 'Middle of funnel' },
    { content_type: 'LinkedIn Post', word_count: 200, funnel_stage: 'Top of funnel' },
    { content_type: 'LinkedIn Post', word_count: 200, funnel_stage: 'Middle of funnel' },
    { content_type: 'LinkedIn Post', word_count: 200, funnel_stage: 'Bottom of funnel' },
    { content_type: 'Monthly Newsletter', word_count: 800, funnel_stage: 'Middle of funnel' },
  ],
};

app.get('/', (req, res) => res.json({ status: 'COaaS backend running', timestamp: new Date().toISOString() }));

app.get('/tiers', (req, res) => {
  const summary = {};
  for (const [tier, items] of Object.entries(TIER_PLANS)) {
    const counts = {};
    for (const item of items) counts[item.content_type] = (counts[item.content_type] || 0) + 1;
    summary[tier] = { total: items.length, breakdown: counts };
  }
  res.json({ tiers: summary });
});

app.post('/clients', async (req, res) => {
  try {
    const { company_name, contact_email } = req.body;
    if (!company_name || !contact_email) return res.status(400).json({ error: 'company_name and contact_email are required' });
    const brand_voice_prompt = buildBrandVoicePrompt(req.body);
    const { data, error } = await supabase.from('clients').insert([{ ...req.body, brand_voice_prompt, status: 'active' }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, client: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/clients', async (req, res) => {
  try {
    const { data, error } = await supabase.from('clients').select('id, company_name, contact_email, retainer_tier, retainer_amount, status, stripe_subscription_id, created_at').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ clients: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/clients/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('clients').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Client not found' });
    res.json({ client: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/briefs', async (req, res) => {
  try {
    const { client_id, content_type } = req.body;
    if (!client_id || !content_type) return res.status(400).json({ error: 'client_id and content_type are required' });
    const { data, error } = await supabase.from('content_briefs').insert([{ ...req.body, due_date: req.body.due_date || new Date().toISOString().split('T')[0], status: 'pending' }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, brief: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/generate', async (req, res) => {
  try {
    const { brief_id, client_id } = req.body;
    if (!brief_id || !client_id) return res.status(400).json({ error: 'brief_id and client_id are required' });
    const [clientRes, briefRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', client_id).single(),
      supabase.from('content_briefs').select('*').eq('id', brief_id).single()
    ]);
    if (clientRes.error) throw clientRes.error;
    if (briefRes.error) throw briefRes.error;
    if (clientRes.data.status === 'payment_failed') return res.status(402).json({ error: 'Payment required' });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 4096,
      system: clientRes.data.brand_voice_prompt,
      messages: [{ role: 'user', content: buildContentPrompt(briefRes.data) }]
    });
    const content = message.content[0].text;
    const wordCount = content.split(/s+/).length;
    const { data: draft, error: draftError } = await supabase.from('drafts').insert([{
      client_id, brief_id, content, word_count: wordCount,
      model_used: 'claude-sonnet-4-20250514',
      tokens_used: message.usage.input_tokens + message.usage.output_tokens, status: 'draft'
    }]).select().single();
    if (draftError) throw draftError;
    await supabase.from('content_briefs').update({ status: 'generated' }).eq('id', brief_id);
    res.json({ success: true, draft });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/generate-monthly/:client_id', async (req, res) => {
  try {
    const { data: client, error } = await supabase.from('clients').select('*').eq('id', req.params.client_id).single();
    if (error || !client) return res.status(404).json({ error: 'Client not found' });
    if (client.status === 'payment_failed') return res.status(402).json({ error: 'Payment required' });
    const plan = TIER_PLANS[client.retainer_tier] || TIER_PLANS['Essentials'];
    const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
    res.json({ success: true, message: 'Generating ' + plan.length + ' pieces for ' + client.company_name + '. Check the portal as they complete.', total: plan.length, tier: client.retainer_tier, breakdown: plan.reduce((acc, p) => { acc[p.content_type] = (acc[p.content_type] || 0) + 1; return acc; }, {}) });
    for (let i = 0; i < plan.length; i++) {
      const piece = plan[i];
      try {
        const titleMsg = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 100, messages: [{ role: 'user', content: 'Generate a compelling title for a ' + piece.content_type + ' for "' + client.company_name + '" which is: ' + (client.product_description || 'a local business') + '. Target: ' + (client.ideal_customer || 'local customers') + '. Topics: ' + (client.topics || 'their services') + '. Funnel stage: ' + piece.funnel_stage + '. Reply with ONLY the title.' }] });
        const title = titleMsg.content[0].text.trim().replace(/^["']|["']$/g, '');
        const { data: brief } = await supabase.from('content_briefs').insert([{ client_id: client.id, content_type: piece.content_type, title, funnel_stage: piece.funnel_stage, word_count: piece.word_count, angle: 'Month: ' + month + '. Write the most useful, concrete piece for ' + (client.ideal_customer || 'this audience') + '. Real value, no fluff.', reader_takeaway: 'The reader leaves with clear, actionable information.', primary_keyword: client.topics ? client.topics.split(',')[0].trim() : '', due_date: new Date().toISOString().split('T')[0], status: 'pending' }]).select().single();
        const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, system: client.brand_voice_prompt, messages: [{ role: 'user', content: buildContentPrompt(brief) }] });
        const content = msg.content[0].text;
        const wordCount = content.split(/s+/).length;
        await supabase.from('drafts').insert([{ client_id: client.id, brief_id: brief.id, content, word_count: wordCount, model_used: 'claude-sonnet-4-20250514', tokens_used: msg.usage.input_tokens + msg.usage.output_tokens, status: 'draft' }]);
        await supabase.from('content_briefs').update({ status: 'generated' }).eq('id', brief.id);
        console.log('  Generated ' + (i+1) + '/' + plan.length + ': ' + piece.content_type + ' - ' + title);
      } catch (err) { console.error('  Failed piece ' + (i+1) + ':', err.message); }
    }
  } catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

app.post('/approve', async (req, res) => {
  try {
    const { draft_id } = req.body;
    if (!draft_id) return res.status(400).json({ error: 'draft_id is required' });
    const { data, error } = await supabase.from('drafts').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', draft_id).select().single();
    if (error) throw error;
    res.json({ success: true, draft: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/drafts/:client_id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('drafts').select('*, content_briefs (title, content_type, primary_keyword)').eq('client_id', req.params.client_id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ drafts: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/billing/create-subscription', async (req, res) => {
  try {
    const { client_id, price_id } = req.body;
    const { data: client, error } = await supabase.from('clients').select('*').eq('id', client_id).single();
    if (error || !client) return res.status(404).json({ error: 'Client not found' });
    let customerId = client.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: client.contact_email, name: client.company_name, metadata: { client_id } });
      customerId = customer.id;
      await supabase.from('clients').update({ stripe_customer_id: customerId }).eq('id', client_id);
    }
    const subscription = await stripe.subscriptions.create({ customer: customerId, items: [{ price: price_id }], payment_behavior: 'default_incomplete', payment_settings: { save_default_payment_method: 'on_subscription' }, expand: ['latest_invoice.payment_intent'], metadata: { client_id } });
    await supabase.from('clients').update({ stripe_subscription_id: subscription.id }).eq('id', client_id);
    res.json({ success: true, subscription_id: subscription.id, client_secret: subscription.latest_invoice.payment_intent.client_secret, status: subscription.status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/billing/cancel', async (req, res) => {
  try {
    const { client_id } = req.body;
    const { data: client } = await supabase.from('clients').select('stripe_subscription_id').eq('id', client_id).single();
    if (!client?.stripe_subscription_id) return res.status(404).json({ error: 'No subscription' });
    const sub = await stripe.subscriptions.update(client.stripe_subscription_id, { cancel_at_period_end: true });
    res.json({ success: true, cancels_at: new Date(sub.cancel_at * 1000) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/billing/status/:client_id', async (req, res) => {
  try {
    const { data: client } = await supabase.from('clients').select('stripe_subscription_id, retainer_tier, retainer_amount').eq('id', req.params.client_id).single();
    if (!client?.stripe_subscription_id) return res.json({ status: 'no_subscription' });
    const sub = await stripe.subscriptions.retrieve(client.stripe_subscription_id);
    res.json({ status: sub.status, current_period_end: new Date(sub.current_period_end * 1000), cancel_at_period_end: sub.cancel_at_period_end, tier: client.retainer_tier, amount: client.retainer_amount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/billing/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); }
  catch (err) { return res.status(400).send('Webhook Error: ' + err.message); }
  switch (event.type) {
    case 'invoice.paid': { const { data: c } = await supabase.from('clients').select('id').eq('stripe_customer_id', event.data.object.customer).single(); if (c) await supabase.from('clients').update({ status: 'active' }).eq('id', c.id); break; }
    case 'invoice.payment_failed': { const { data: c } = await supabase.from('clients').select('id').eq('stripe_customer_id', event.data.object.customer).single(); if (c) await supabase.from('clients').update({ status: 'payment_failed' }).eq('id', c.id); break; }
    case 'customer.subscription.deleted': { const { data: c } = await supabase.from('clients').select('id').eq('stripe_subscription_id', event.data.object.id).single(); if (c) await supabase.from('clients').update({ status: 'cancelled' }).eq('id', c.id); break; }
  }
  res.json({ received: true });
});

cron.schedule('0 8 1 * *', async () => {
  console.log('Monthly cron: generating for all active clients...');
  try {
    const { data: clients } = await supabase.from('clients').select('id, company_name, retainer_tier').eq('status', 'active');
    for (const client of (clients || [])) {
      await fetch('http://localhost:' + PORT + '/generate-monthly/' + client.id, { method: 'POST' });
      console.log('Started monthly generation for ' + client.company_name);
    }
  } catch (err) { console.error('Monthly cron error:', err); }
});

function buildBrandVoicePrompt(data) {
  const tones = Array.isArray(data.tones) ? data.tones.join(', ') : (data.tones || 'professional, friendly');
  return 'Brand Voice - ' + data.company_name + '\nAbout: ' + (data.product_description || '[description]') + '\nTarget customer: ' + (data.ideal_customer || 'local customers') + (data.differentiator ? '\nDifferentiator: ' + data.differentiator : '') + '\nTone: ' + tones + '\nFormality: ' + (data.formality || 'Balanced') + '\nRules:\n- Sound like a real person\n- Lead with value not features\n- Short sentences, active voice\n- Specific details beat vague claims\n- Never use "In todays fast-paced world..."' + (data.avoid_list ? '\n- Never: ' + data.avoid_list : '') + (data.extra_notes ? '\nNotes: ' + data.extra_notes : '');
}

function buildContentPrompt(brief) {
  const instructions = { 'Blog Post': 'Write a complete SEO-optimized blog post with compelling intro, clear headings, strong conclusion.', 'Email Newsletter': 'Write a concise email newsletter with subject line at top, short paragraphs, one clear CTA.', 'LinkedIn Post': 'Write a LinkedIn post. Hook first line (no "I" to start). Short punchy lines. End with question or CTA. No hashtags.', 'Social Media Post': 'Write an engaging social media post. Short, punchy, conversational. Clear CTA.', 'Monthly Newsletter': 'Write a monthly newsletter: personal note, key updates, tips, and CTA sections.', 'Case Study': 'Write a case study with Challenge, Solution, Results sections. Use specific numbers.', 'Landing Page Copy': 'Write landing page copy: headline, subheadline, benefits (not features), social proof placeholder, CTA.' };
  const instr = instructions[brief.content_type] || 'Write a complete publish-ready piece.';
  return instr + '\n\nBrief:\n- Title: ' + (brief.title || 'Choose compelling title') + '\n- Word count: ~' + (brief.word_count || 800) + '\n- Funnel stage: ' + (brief.funnel_stage || 'Top of funnel') + (brief.angle ? '\n- Angle: ' + brief.angle : '') + (brief.primary_keyword ? '\n- Keyword: ' + brief.primary_keyword : '') + (brief.cta ? '\n- CTA: ' + brief.cta : '') + '\n\nApply brand voice. Produce complete publish-ready piece, no placeholders.';
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('COaaS backend running on port ' + PORT));
