// Alex Reeves - AI Leasing Assistant | OKC Real
// See README.md for full setup instructions
// Pause tag: "Alex Pause" - add to any FUB contact to silence Alex

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const twilio = require('twilio');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const { PORT=3001, ALEX_FUB_API_KEY, ALEX_TWILIO_NUMBER, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, XAI_API_KEY, SERVER_URL } = process.env;
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const TAGS = {
    PAUSE: 'Alex Pause',
    SENT: 'Alex Showing Sent',
    NEEDS_HUMAN: 'Alex Needs Human',
    INTERESTED: 'Alex Interested',
    MAINTENANCE: 'Alex Maintenance',
};

const activeChats = new Map();

const fub = axios.create({
    baseURL: 'https://api.followupboss.com/v1',
    auth: { username: ALEX_FUB_API_KEY, password: '' },
    headers: { 'Content-Type': 'application/json' },
});

function normalizePhone(raw) {
    if (!raw) return null;
    const d = (raw || '').replace(/\D/g, '');
    if (d.length === 10) return '+1' + d;
    if (d.length === 11 && d[0] === '1') return '+' + d;
    return null;
}

function nowCST() {
    return new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' CST';
}

function msUntilNextMorning(hour = 10) {
    const cst = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const next = new Date(cst);
    next.setDate(next.getDate() + 1);
    next.setHours(hour, Math.floor(Math.random() * 30), 0, 0);
    return Math.max(60000, next.getTime() - cst.getTime());
}

function isNaturalEnd(msg = '') {
    return /\b(thanks|thank you|bye|not interested|going to apply|love it|perfect|sounds good|got it|no thanks|pass)\b/i.test(msg);
}

async function isAlexPaused(personId) {
    if (!personId) return false;
    try {
          const { data } = await fub.get('/people/' + personId);
          const paused = (data.tags || []).includes(TAGS.PAUSE);
          if (paused) console.log('[Alex] Paused on person ' + personId + ' - silent');
          return paused;
    } catch (e) { return false; }
}

async function lookupPerson(phone, email = null) {
    try {
          const digits = (phone || '').replace(/\D/g, '').slice(-10);
          if (digits) {
                  const { data } = await fub.get('/people', { params: { limit: 5, phone: digits } });
                  if ((data.people || []).length) return data.people[0];
          }
          if (email) {
                  const { data } = await fub.get('/people', { params: { limit: 5, email } });
                  if ((data.people || []).length) return data.people[0];
          }
    } catch (e) { console.error('[Alex] Lookup error:', e.message); }
    return null;
}

async function sendText(toPhone, message, personId) {
    if (personId && await isAlexPaused(personId)) return false;
    try {
          await twilioClient.messages.create({ from: ALEX_TWILIO_NUMBER, to: toPhone, body: message });
          if (personId) {
                  await fub.post('/textMessages', { personId, message, isIncoming: false, toNumber: toPhone, fromNumber: ALEX_TWILIO_NUMBER }).catch(() => {});
          }
          console.log('[Alex] SMS ->', toPhone, message.slice(0, 50));
          return true;
    } catch (e) { console.error('[Alex] Send error:', e.message); return false; }
}

async function postNote(personId, body) {
    if (!personId) return;
    try { await fub.post('/notes', { personId, body, isHtml: false }); }
    catch (e) { console.error('[Alex] Note error:', e.message); }
}

async function updateTags(personId, add = [], remove = []) {
    if (!personId) return;
    try {
          const { data } = await fub.get('/people/' + personId);
          let tags = (data.tags || []).filter(t => !remove.includes(t));
          for (const t of add) { if (!tags.includes(t)) tags.push(t); }
          await fub.put('/people/' + personId, { tags });
    } catch (e) { console.error('[Alex] Tag error:', e.message); }
}

async function grokReply(session, prospectMessage, photoUrls = []) {
    const transcript = session.transcript.map(t => t.role + ': ' + t.content).join('\n');
    const photoCtx = photoUrls.length ? '\nProspect sent ' + photoUrls.length + ' photo(s): ' + photoUrls.join(', ') + '\nDescribe likely maintenance issues.' : '';
    try {
          const { data } = await axios.post('https://api.x.ai/v1/chat/completions', {
                  model: 'grok-3-fast',
                  messages: [{ role: 'user', content: 'You are Alex Reeves, AI leasing assistant for OKC Real, Oklahoma City.\nTexting prospect about tour at ' + session.propertyName + '.\nGoals: gather feedback, note maintenance issues, encourage application if interested.\n1-2 sentences max. Casual and warm. This is SMS.\n' + photoCtx + '\nConversation:\n' + transcript + '\nLatest: "' + (prospectMessage || '[photo]') + '"\nJSON only (no markdown): {"reply":"","issues":[],"sentiment":"very_positive|positive|neutral|negative","needsHuman":false,"done":false}' }],
                  max_tokens: 300,
          }, { headers: { Authorization: 'Bearer ' + XAI_API_KEY, 'Content-Type': 'application/json' } });
          const raw = data.choices?.[0]?.message?.content || '{}';
          const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
          return { reply: parsed.reply || 'Thanks!', issues: parsed.issues || [], sentiment: parsed.sentiment || 'neutral', needsHuman: parsed.needsHuman || false, done: parsed.done || false };
    } catch (e) {
          return { reply: 'Thanks for touring! Reach out anytime.', issues: [], sentiment: 'neutral', needsHuman: false, done: false };
    }
}

async function triggerFollowUp({ name, phone, email, address, propertyName }) {
    const normalized = normalizePhone(phone);
    if (!normalized) { console.warn('[Alex] No valid phone - skipping'); return; }
    const person = await lookupPerson(normalized, email);
    const personId = person?.id || null;
    const firstName = (name || 'there').split(' ')[0];
    const display = propertyName || address || 'the property';
    if (personId && await isAlexPaused(personId)) return;
    if (person?.tags?.includes(TAGS.SENT)) { console.log('[Alex] Already followed up with', name); return; }

  const msg1 = 'Hi ' + firstName + '! This is Alex Reeves with OKC Real. I see you scheduled a tour at ' + display + ' -- exciting! Text me any questions before or after your visit.';
    const sent = await sendText(normalized, msg1, personId);
    if (!sent) return;

  activeChats.set(normalized, {
        personId, prospectName: name || 'Prospect', firstName, propertyName: display,
        transcript: [{ role: 'Alex Reeves', content: msg1 }],
        mediaItems: [], allIssues: [], sentiment: 'neutral',
        needsHuman: false, posted: false, openedAt: Date.now(), lastActivity: Date.now(),
  });

  const delay = msUntilNextMorning(10);
    setTimeout(async () => {
          const session = activeChats.get(normalized);
          if (!session || session.posted) return;
          if (await isAlexPaused(session.personId)) return;
          const msg2 = 'Hi ' + firstName + '! Hope your tour at ' + display + ' went well -- what did you think? Any questions?';
          await sendText(normalized, msg2, session.personId);
          session.transcript.push({ role: 'Alex Reeves', content: msg2 });
          session.lastActivity = Date.now();
    }, delay);
    console.log('[Alex] Follow-up started for', name, '| Touch 2 in', Math.round(delay / 3600000 * 10) / 10 + 'h');
}

async function postFeedback(session) {
    const sLabel = { very_positive: 'Very Positive', positive: 'Positive', neutral: 'Neutral', negative: 'Negative' }[session.sentiment] || 'Unknown';
    const noteBody = [
          'Showing Feedback -- ' + session.propertyName,
          'Prospect: ' + session.prospectName,
          'Date: ' + nowCST(),
          'Sentiment: ' + sLabel,
          session.allIssues.length ? 'MAINTENANCE ISSUES:\n' + session.allIssues.map(i => ' - ' + i).join('\n') : 'No maintenance issues reported',
          session.mediaItems.length ? 'PHOTOS FROM PROSPECT:\n' + session.mediaItems.map((u, i) => '[Photo ' + (i + 1) + ']: ' + u).join('\n') : '',
          '', '--- Transcript ---',
          session.transcript.map(t => t.role + ': ' + t.content).join('\n'),
          '--- End ---', '',
          'Posted by Alex Reeves (AI Leasing Assistant) | OKC Real',
        ].join('\n');
    await postNote(session.personId, noteBody);
    const tagsToAdd = [TAGS.SENT];
    if (session.allIssues.length) tagsToAdd.push(TAGS.MAINTENANCE);
    if (session.sentiment === 'very_positive') tagsToAdd.push(TAGS.INTERESTED);
    if (session.needsHuman) tagsToAdd.push(TAGS.NEEDS_HUMAN);
    await updateTags(session.personId, tagsToAdd, []);
    if (session.allIssues.length && session.personId) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          await fub.post('/tasks', {
                  personId: session.personId,
                  dueDate: tomorrow.toISOString().split('T')[0],
                  note: 'Maintenance follow-up at ' + session.propertyName + ':\n' + session.allIssues.map(i => '- ' + i).join('\n') + '\nReported during self-guided tour.\n-- Alex Reeves (AI)',
                  isCompleted: false,
          }).catch(() => {});
          console.log('[Alex] Maintenance task created for', session.propertyName);
    }
    console.log('[Alex] Feedback posted for', session.prospectName);
}

function parseGuestCardEmail(text, subject) {
    const addressMatch = subject.match(/New Interest for (.+)/i) || [];
    const address = (addressMatch[1] || '').trim();
    const phoneMatch = text.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    const phone = phoneMatch ? phoneMatch[0] : null;
    const emailMatch = (text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []);
    const email = emailMatch.find(e => !e.includes('appfolio') && !e.includes('okcreal')) || null;
    const nameMatch = text.match(/CONTACT INFO[\s\S]{0,100}\n\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)/);
    const name = nameMatch ? nameMatch[1].trim() : 'Prospect';
    return { name, phone, email, address, propertyName: address };
}

setInterval(async () => {
    const cutoff = Date.now() - 4 * 60 * 60 * 1000;
    for (const [phone, session] of activeChats.entries()) {
          if ((session.lastActivity || session.openedAt) < cutoff && !session.posted) {
                  session.posted = true;
                  console.log('[Alex] Auto-closing stale session for', phone);
                  await postFeedback(session);
                  activeChats.delete(phone);
          }
    }
}, 30 * 60 * 1000);

// Inbound SMS from prospects
app.post('/sms', async (req, res) => {
    const twiml = new twilio.twiml.MessagingResponse();
    res.type('text/xml').send(twiml.toString());
    const fromPhone = req.body.From || '';
    const body = (req.body.Body || '').trim();
    const numMedia = parseInt(req.body.NumMedia || '0');
    const mediaUrls = [];
    for (let i = 0; i < numMedia; i++) { const url = req.body['MediaUrl' + i]; if (url) mediaUrls.push(url); }
    const phone = normalizePhone(fromPhone);
    const session = activeChats.get(phone);
    const person = !session ? await lookupPerson(phone) : null;
    const personId = session?.personId || person?.id || null;
    if (personId) {
          await fub.post('/textMessages', { personId, message: body || '[Photo]', isIncoming: true, fromNumber: fromPhone, toNumber: ALEX_TWILIO_NUMBER }).catch(() => {});
    }
    if (!session) {
          if (!body) return;
          try {
                  const { data } = await axios.post('https://api.x.ai/v1/chat/completions', {
                            model: 'grok-3-fast',
                            messages: [{ role: 'user', content: 'You are Alex Reeves, AI leasing assistant for OKC Real. Someone texted: "' + body + '". Reply warmly in 1-2 sentences. Help with rental questions.' }],
                            max_tokens: 120,
                  }, { headers: { Authorization: 'Bearer ' + XAI_API_KEY, 'Content-Type': 'application/json' } });
                  const reply = data.choices?.[0]?.message?.content?.trim() || 'Hi! Alex Reeves with OKC Real -- how can I help?';
                  await sendText(fromPhone, reply, personId);
                  if (personId) await postNote(personId, 'Inbound text via Alex:\nProspect: "' + body + '"\nAlex: "' + reply + '"\n-- Alex Reeves (AI) | ' + nowCST());
          } catch (e) { console.error('[Alex] General inbound error:', e.message); }
          return;
    }
    if (await isAlexPaused(session.personId)) return;
    if (mediaUrls.length) session.mediaItems.push(...mediaUrls);
    if (body) session.transcript.push({ role: session.firstName, content: body });
    if (mediaUrls.length) session.transcript.push({ role: session.firstName, content: '[' + mediaUrls.length + ' photo(s): ' + mediaUrls.join(', ') + ']' });
    const { reply, issues, sentiment, needsHuman, done } = await grokReply(session, body, mediaUrls);
    if (issues.length) session.allIssues.push(...issues);
    session.sentiment = sentiment;
    session.needsHuman = needsHuman || session.needsHuman;
    session.lastActivity = Date.now();
    session.transcript.push({ role: 'Alex Reeves', content: reply });
    await sendText(fromPhone, reply, session.personId);
    if ((done || isNaturalEnd(body)) && !session.posted) {
          session.posted = true;
          await postFeedback(session);
          setTimeout(() => activeChats.delete(phone), 30 * 60 * 1000);
    }
});

// AppFolio guest card email arrives via SendGrid/Gmail forward
app.post('/guest-card', async (req, res) => {
    res.sendStatus(200);
    try {
          const text = req.body.text || req.body.body || '';
          const subject = req.body.subject || '';
          const prospect = parseGuestCardEmail(text, subject);
          console.log('[Alex] Guest card:', prospect.name, '|', prospect.phone, '|', prospect.address);
          await triggerFollowUp(prospect);
    } catch (e) { console.error('[Alex] Guest card error:', e.message); }
});

// Manual test - POST /test {"name":"Landon Whitt","phone":"4055499381","address":"3128 NE 15th St"}
app.post('/test', async (req, res) => {
    const { name, phone, address, propertyName } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    res.json({ success: true, message: 'Triggering Alex follow-up for ' + (name || phone) });
    await triggerFollowUp({ name, phone, address, propertyName });
});

app.get('/', (req, res) => res.json({
    agent: 'Alex Reeves | AI Leasing Assistant | OKC Real',
    status: 'online',
    activeChats: activeChats.size,
    alexNumber: ALEX_TWILIO_NUMBER,
    webhooks: { inboundSMS: SERVER_URL + '/sms', guestCard: SERVER_URL + '/guest-card', test: 'POST ' + SERVER_URL + '/test' },
    pauseTag: TAGS.PAUSE,
    tags: TAGS,
}));

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.listen(PORT, () => {
    console.log('\nAlex Reeves | AI Leasing Assistant | OKC Real');
    console.log('Port:', PORT);
    console.log('SMS Number:', ALEX_TWILIO_NUMBER);
    console.log('Inbound SMS:', SERVER_URL + '/sms');
    console.log('Guest Card:', SERVER_URL + '/guest-card');
    console.log('Pause Tag: "' + TAGS.PAUSE + '"\n');
});
