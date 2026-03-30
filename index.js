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
const PORTAL_URL = 'https://stupendous-sable-fc0707.netlify.app/portal.html';
const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL || 'lumetra1agency@gmail.com';

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

// ── Email helper ─────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Lumetra <onboarding@resend.dev>', to: Array.isArray(to) ? to : [to], subject, html })
    });
    const data = await res.json();
    console.log('Email sent:', subject, '-> ', to);
  } catch (err) { console.error('Email error:', err.message); }
}

function emailStyle(content) {
  return '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:40px 24px;background:#060608;color:#f0eeff;"><div style="margin-bottom:28px;font-size:22px;font-weight:800;color:#9B7FEF;">Lumetra</div>' + content + '<p style="color:#4a4760;font-size:12px;margin-top:32px;">— The Lumetra team</p></div>';
}

async function sendWelcomeEmail(client, accessCode) {
  await sendEmail({
    to: client.contact_email,
    subject: 'Welcome to Lumetra — your content portal is ready',
    html: emailStyle('<h1 style="font-size:26px;font-weight:700;margin-bottom:12px;">Welcome, ' + (client.contact_name || client.company_name) + '.</h1><p style="color:#8a87aa;line-height:1.7;margin-bottom:24px;">Your content portal is live. Each month we generate your full content plan and drop it in your portal for review. Your only job is to approve.</p><div style="background:#0d0d12;border:1px solid rgba(155,127,239,0.3);border-radius:12px;padding:24px;margin-bottom:24px;"><p style="color:#8a87aa;margin-bottom:8px;">Portal: <a href="' + PORTAL_URL + '" style="color:#9B7FEF;">' + PORTAL_URL + '</a></p><p style="color:#8a87aa;margin-bottom:8px;">Email: <strong style="color:#f0eeff;">' + client.contact_email + '</strong></p><p style="color:#8a87aa;">Access code: <strong style="font-size:22px;letter-spacing:0.12em;color:#9B7FEF;">' + accessCode + '</strong></p></div><a href="' + PORTAL_URL + '" style="display:inline-block;padding:12px 24px;background:#9B7FEF;color:#000;font-weight:700;border-radius:10px;text-decoration:none;">Open my portal</a>')
  });
}

async function sendContentReadyEmail(client, totalPieces, breakdown) {
  const accessCode = client.id.replace(/-/g,'').slice(-6).toUpperCase();
  const month = new Date().toLocaleString('en-US', { month: 'long' });
  const breakdownHtml = Object.entries(breakdown).map(([k,v]) => '<li style="color:#8a87aa;padding:3px 0;">' + v + ' ' + k + (v>1?'s':'') + '</li>').join('');
  await sendEmail({
    to: client.contact_email,
    subject: 'Your ' + month + ' content is ready to review — ' + totalPieces + ' pieces',
    html: emailStyle('<h1 style="font-size:26px;font-weight:700;margin-bottom:12px;">Your content is ready.</h1><p style="color:#8a87aa;line-height:1.7;margin-bottom:24px;">' + totalPieces + ' pieces for ' + client.company_name + ' are in your portal, written in your voice and ready to approve.</p><div style="background:#0d0d12;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;margin-bottom:24px;"><p style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#4a4760;margin-bottom:10px;">This month</p><ul style="list-style:none;padding:0;margin:0;">' + breakdownHtml + '</ul></div><a href="' + PORTAL_URL + '" style="display:inline-block;padding:12px 24px;background:#9B7FEF;color:#000;font-weight:700;border-radius:10px;text-decoration:none;">Review my content</a><p style="color:#4a4760;font-size:12px;margin-top:16px;">Login: ' + client.contact_email + ' / ' + accessCode + '</p>')
  });
}

async function sendFeedbackEmail(client, draftTitle, feedbackText) {
  await sendEmail({
    to: OPERATOR_EMAIL,
    subject: 'Revision requested — ' + client.company_name + ': "' + draftTitle + '"',
    html: emailStyle('<h1 style="font-size:24px;font-weight:700;margin-bottom:8px;">Revision requested</h1><p style="color:#8a87aa;margin-bottom:20px;"><strong style="color:#f0eeff;">' + client.company_name + '</strong> (' + client.contact_email + ') wants changes.</p><div style="background:#0d0d12;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;"><p style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#4a4760;margin-bottom:6px;">Piece</p><p style="color:#f0eeff;margin-bottom:16px;">' + draftTitle + '</p><p style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#4a4760;margin-bottom:6px;">Feedback</p><p style="color:#f0eeff;line-height:1.7;">' + feedbackText + '</p></div>')
  });
}

async function sendSignupEmail(bizName, contactName, email, plan) {
  await sendEmail({
    to: OPERATOR_EMAIL,
    subject: 'New signup — ' + bizName + ' (' + (plan || 'plan TBD') + ')',
    html: emailStyle('<h1 style="font-size:24px;font-weight:700;margin-bottom:8px;color:#7EE8A2;">New signup ✦</h1><p style="color:#8a87aa;margin-bottom:20px;">Someone just submitted the Get Started form.</p><div style="background:#0d0d12;border:1px solid rgba(126,232,162,0.3);border-radius:12px;padding:24px;"><p style="color:#8a87aa;margin-bottom:8px;">Business: <strong style="color:#f0eeff;">' + bizName + '</strong></p><p style="color:#8a87aa;margin-bottom:8px;">Name: <strong style="color:#f0eeff;">' + (contactName||'Not provided') + '</strong></p><p style="color:#8a87aa;margin-bottom:8px;">Email: <strong style="color:#9B7FEF;">' + email + '</strong></p><p style="color:#8a87aa;">Plan: <strong style="color:#f0eeff;">' + (plan||'Not sure yet') + '</strong></p></div><p style="color:#8a87aa;margin-top:16px;">Reply to <a href="mailto:' + email + '" style="color:#9B7FEF;">' + email + '</a> within 24 hours.</p>')
  });
}

// ── Health check ─────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'Lumetra backend running', timestamp: new Date().toISOString() }));

app.get('/tiers', (req, res) => {
  const summary = {};
  for (const [tier, items] of Object.entries(TIER_PLANS)) {
    const counts = {};
    for (const item of items) counts[item.content_type] = (counts[item.content_type] || 0) + 1;
    summary[tier] = { total: items.length, breakdown: counts };
  }
  res.json({ tiers: summary });
});

// ── Signup notification endpoint ─────────────────────────
app.post('/notify-signup', async (req, res) => {
  try {
    const { biz_name, contact_name, email, plan } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    await sendSignupEmail(biz_name, contact_name, email, plan);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Feedback endpoint ────────────────────────────────────
app.post('/feedback', async (req, res) => {
  try {
    const { draft_id, client_id, feedback_text } = req.body;
    if (!draft_id || !client_id || !feedback_text) return res.status(400).json({ error: 'draft_id, client_id, feedback_text required' });
    const { data: client } = await supabase.from('clients').select('*').eq('id', client_id).single();
    const { data: brief } = await supabase.from('content_briefs').select('title').eq('id', (await supabase.from('drafts').select('brief_id').eq('id', draft_id).single()).data?.brief_id).single();
    await sendFeedbackEmail(client, brief?.title || 'Untitled piece', feedback_text);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/clients', async (req, res) => {
  try {
    const { company_name, contact_email } = req.body;
    if (!company_name || !contact_email) return res.status(400).json({ error: 'company_name and contact_email are required' });
    const brand_voice_prompt = buildBrandVoicePrompt(req.body);
    const { data, error } = await supabase.from('clients').insert([{ ...req.body, brand_voice_prompt, status: 'active' }]).select().single();
    if (error) throw error;
    // Send welcome email with access code
    const accessCode = data.id.replace(/-/g,'').slice(-6).toUpperCase();
    sendWelcomeEmail(data, accessCode).catch(console.error);
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

app.delete('/clients/:id', async (req, res) => {
  try {
    const { error: draftsErr } = await supabase.from('drafts').delete().eq('client_id', req.params.id);
    if (draftsErr) throw draftsErr;
    const { error: briefsErr } = await supabase.from('content_briefs').delete().eq('client_id', req.params.id);
    if (briefsErr) throw briefsErr;
    const { error: clientErr } = await supabase.from('clients').delete().eq('id', req.params.id);
    if (clientErr) throw clientErr;
    res.json({ success: true, message: 'Client and all associated data deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/briefs', async (req, res) => {
  try {
    const { client_id, content_type } = req.body;
    if (!client_id || !content_type) return res.status(400).json({ error: 'client_id and content_type required' });
    const { data, error } = await supabase.from('content_briefs').insert([{ ...req.body, due_date: req.body.due_date || new Date().toISOString().split('T')[0], status: 'pending' }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, brief: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/generate', async (req, res) => {
  try {
    const { brief_id, client_id } = req.body;
    if (!brief_id || !client_id) return res.status(400).json({ error: 'brief_id and client_id required' });
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
    const breakdown = plan.reduce((acc, p) => { acc[p.content_type] = (acc[p.content_type] || 0) + 1; return acc; }, {});
    res.json({ success: true, message: 'Generating ' + plan.length + ' pieces for ' + client.company_name, total: plan.length, tier: client.retainer_tier, breakdown });
    const results = [];
    for (let i = 0; i < plan.length; i++) {
      const piece = plan[i];
      try {
        const titleMsg = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 100, messages: [{ role: 'user', content: 'Generate a compelling title for a ' + piece.content_type + ' for "' + client.company_name + '" which is: ' + (client.product_description || 'a local business') + '. Target: ' + (client.ideal_customer || 'local customers') + '. Topics: ' + (client.topics || 'their services') + '. Funnel stage: ' + piece.funnel_stage + '. Reply with ONLY the title.' }] });
        const title = titleMsg.content[0].text.trim().replace(/^["']|["']$/g, '');
        const { data: brief } = await supabase.from('content_briefs').insert([{ client_id: client.id, content_type: piece.content_type, title, funnel_stage: piece.funnel_stage, word_count: piece.word_count, angle: 'Month: ' + month + '. Write the most useful, concrete piece for ' + (client.ideal_customer || 'this audience') + '.', reader_takeaway: 'Clear, actionable information.', primary_keyword: client.topics ? client.topics.split(',')[0].trim() : '', due_date: new Date().toISOString().split('T')[0], status: 'pending' }]).select().single();
        const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, system: client.brand_voice_prompt, messages: [{ role: 'user', content: buildContentPrompt(brief) }] });
        const content = msg.content[0].text;
        await supabase.from('drafts').insert([{ client_id: client.id, brief_id: brief.id, content, word_count: content.split(/s+/).length, model_used: 'claude-sonnet-4-20250514', tokens_used: msg.usage.input_tokens + msg.usage.output_tokens, status: 'draft' }]);
        await supabase.from('content_briefs').update({ status: 'generated' }).eq('id', brief.id);
        results.push({ title, content_type: piece.content_type });
        console.log('Generated ' + (i+1) + '/' + plan.length + ': ' + piece.content_type);
      } catch (err) { console.error('Failed piece ' + (i+1) + ':', err.message); }
    }
    // Email client when all done
    sendContentReadyEmail(client, results.length, breakdown).catch(console.error);
    console.log('Monthly generation complete for ' + client.company_name + ': ' + results.length + ' pieces');
  } catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

app.post('/approve', async (req, res) => {
  try {
    const { draft_id } = req.body;
    if (!draft_id) return res.status(400).json({ error: 'draft_id required' });
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
    const { data: clients } = await supabase.from('clients').select('id, company_name').eq('status', 'active');
    for (const client of (clients || [])) {
      await fetch('http://localhost:' + PORT + '/generate-monthly/' + client.id, { method: 'POST' });
    }
  } catch (err) { console.error('Cron error:', err); }
});

function buildBrandVoicePrompt(data) {
  const tones = Array.isArray(data.tones) ? data.tones.join(', ') : (data.tones || 'professional, friendly');
  return 'Brand Voice - ' + data.company_name + '\nAbout: ' + (data.product_description || '[description]') + '\nTarget customer: ' + (data.ideal_customer || 'local customers') + (data.differentiator ? '\nDifferentiator: ' + data.differentiator : '') + '\nTone: ' + tones + '\nFormality: ' + (data.formality || 'Balanced') + '\nRules: Lead with value. Short sentences. Active voice. Specific details.' + (data.avoid_list ? '\nNever: ' + data.avoid_list : '') + (data.extra_notes ? '\nNotes: ' + data.extra_notes : '');
}

function buildContentPrompt(brief) {
  const instructions = { 'Blog Post': 'Write a complete SEO-optimized blog post with compelling intro, clear headings, strong conclusion.', 'Email Newsletter': 'Write a concise email newsletter with subject line at top, short paragraphs, one clear CTA.', 'LinkedIn Post': 'Write a LinkedIn post. Hook first line (no "I" to start). Short punchy lines. End with question or CTA. No hashtags.', 'Social Media Post': 'Write an engaging social media post. Short, punchy, conversational. Clear CTA.', 'Monthly Newsletter': 'Write a monthly newsletter: personal note, key updates, tips, and CTA sections.', 'Case Study': 'Write a case study with Challenge, Solution, Results sections. Use specific numbers.', 'Landing Page Copy': 'Write landing page copy: headline, subheadline, benefits, social proof placeholder, CTA.' };
  const instr = instructions[brief.content_type] || 'Write a complete publish-ready piece.';
  return instr + '\n\nBrief:\n- Title: ' + (brief.title || 'Choose compelling title') + '\n- Word count: ~' + (brief.word_count || 800) + '\n- Funnel stage: ' + (brief.funnel_stage || 'Top of funnel') + (brief.angle ? '\n- Angle: ' + brief.angle : '') + (brief.primary_keyword ? '\n- Keyword: ' + brief.primary_keyword : '') + (brief.cta ? '\n- CTA: ' + brief.cta : '') + '\n\nApply brand voice. Produce complete publish-ready piece.';
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Lumetra backend running on port ' + PORT));
