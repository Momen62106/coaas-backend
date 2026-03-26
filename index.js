import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import cron from 'node-cron';

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/', (req, res) => {
  res.json({ status: 'COaaS backend running', timestamp: new Date().toISOString() });
});

app.post('/clients', async (req, res) => {
  try {
    const brand_voice_prompt = buildBrandVoicePrompt(req.body);
    const { data, error } = await supabase.from('clients').insert([{ ...req.body, brand_voice_prompt, status: 'active' }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, client: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/clients', async (req, res) => {
  try {
    const { data, error } = await supabase.from('clients').select('id, company_name, contact_email, retainer_tier, retainer_amount, status, created_at').order('created_at', { ascending: false });
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
    const { data, error } = await supabase.from('content_briefs').insert([{ ...req.body, due_date: req.body.due_date || new Date().toISOString().split('T')[0], status: 'pending' }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, brief: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/generate', async (req, res) => {
  try {
    const { brief_id, client_id } = req.body;
    const [clientRes, briefRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', client_id).single(),
      supabase.from('content_briefs').select('*').eq('id', brief_id).single()
    ]);
    if (clientRes.error) throw clientRes.error;
    if (briefRes.error) throw briefRes.error;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: clientRes.data.brand_voice_prompt,
      messages: [{ role: 'user', content: buildContentPrompt(briefRes.data) }]
    });

    const content = message.content[0].text;
    const { data: draft, error } = await supabase.from('drafts').insert([{
      client_id, brief_id, content,
      word_count: content.split(/\s+/).length,
      model_used: 'claude-sonnet-4-20250514',
      tokens_used: message.usage.input_tokens + message.usage.output_tokens,
      status: 'draft'
    }]).select().single();
    if (error) throw error;

    await supabase.from('content_briefs').update({ status: 'generated' }).eq('id', brief_id);
    res.json({ success: true, draft });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/approve', async (req, res) => {
  try {
    const { data, error } = await supabase.from('drafts').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', req.body.draft_id).select().single();
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

cron.schedule('0 8 * * *', async () => {
  console.log('Daily cron: checking pending briefs...');
  const today = new Date().toISOString().split('T')[0];
  const { data: briefs } = await supabase.from('content_briefs').select('id, client_id').eq('status', 'pending').lte('due_date', today);
  for (const brief of (briefs || [])) {
    await fetch(`http://localhost:${PORT}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief_id: brief.id, client_id: brief.client_id }) });
  }
});

function buildBrandVoicePrompt(d) {
  return `# Brand Voice — ${d.company_name}\n\nProduct: ${d.product_description}\nCustomer: ${d.ideal_customer}\nDifferentiator: ${d.differentiator}\nPersonality: ${d.brand_personality}\nTone: ${Array.isArray(d.tones) ? d.tones.join(', ') : d.tones || 'professional'}\n\nAlways: lead with value, use active voice, be specific with numbers.\nNever: use filler openers, buzzwords, or passive voice.\n\nProduce complete publish-ready drafts.`;
}

function buildContentPrompt(b) {
  return `Write this ${b.content_type} (target ${b.word_count || 1000} words):\n\nTitle: ${b.title}\nAngle: ${b.angle}\nTakeaway: ${b.reader_takeaway}\nKeyword: ${b.primary_keyword}\nFunnel: ${b.funnel_stage}\n${b.structure ? 'Structure:\n' + b.structure : ''}\n${b.cta ? 'CTA: ' + b.cta : ''}\n\nProduce a complete, publish-ready draft.`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`COaaS backend running on port ${PORT}`));
