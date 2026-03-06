/**
 * Alex Reeves — AI Team Member | OKC Real
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Alex works inside Follow Up Boss like any other staff member.
 * Mention @alex in a note and describe what you need. He reads it,
 * figures out the best set of actions, and executes using FUB's full
 * toolset — texts, emails, calls, notes, tags, stage updates, tasks, and more.
 *
 * EXAMPLES:
 *   "@alex text this lead and ask why they didn't schedule a tour. Follow up
 *    until they respond."
 *
 *   "@alex send a welcome email to this lead, tag them as 'Hot Lead', and
 *    move them to the Active stage."
 *
 *   "@alex this lead went cold. Send a re-engagement text, create a follow-up
 *    task for next week, and tag them as 'Needs Attention'."
 *
 *   "@alex leave a note summarizing where we are with this lead and what
 *    the next steps should be."
 *
 *   "@alex email this lead the availability for 123 NW 5th St and ask if
 *    they want to schedule a showing."
 *
 * SETUP:
 *   1. Create FUB user: Alex Reeves | alex.reeves@okcreal.com | role = Agent
 *   2. Assign a FUB Calling number to Alex (Admin → Calling → Add Number)
 *   3. Log in as Alex → Admin → API → Generate API Key
 *   4. Create FUB webhook pointing to: https://your-railway-url/fub-webhook
 *      Events: note.created, textMessage.received, email.received
 *   5. Add env vars in Railway (see .env.example)
 */

require('dotenv').config();
const express = require('express');
const axios   = require('axios');

const app = express();
app.use(express.json());

const {
  PORT             = 3001,
  ALEX_FUB_API_KEY,
  OWNER_FUB_API_KEY,
  SERVER_URL       = 'http://localhost:3001',
  XAI_API_KEY,
} = process.env;

// ─── FUB client — all actions run as Alex ─────────────────────────────────
const fub = axios.create({
  baseURL: 'https://api.followupboss.com/v1',
  auth:    { username: ALEX_FUB_API_KEY, password: '' },
  headers: { 'Content-Type': 'application/json' },
});

// Owner client used for actions that require elevated permissions (e.g. sending texts)
const fubOwner = axios.create({
  baseURL: 'https://api.followupboss.com/v1',
  auth:    { username: OWNER_FUB_API_KEY || ALEX_FUB_API_KEY, password: '' },
  headers: { 'Content-Type': 'application/json' },
});

// ─── Active follow-up tasks Alex is managing ──────────────────────────────
const activeTasks = new Map(); // taskId → task object
let alexUserId    = null;

// ══════════════════════════════════════════════════════════════════════════════
// FUB DATA HELPERS
// ══════════════════════════════════════════════════════════════════════════════

async function getAlexUserId() {
  if (alexUserId) return alexUserId;
  try {
    const { data } = await fub.get('/identity');
    alexUserId = data.id;
    return alexUserId;
  } catch (e) {
    console.error('[Alex] identity fetch failed:', e.message);
    return null;
  }
}

async function getPerson(personId) {
  try {
    const { data } = await fub.get('/people/' + personId);
    return data;
  } catch (e) { return null; }
}

async function getRecentTexts(personId, limit = 10) {
  try {
    const { data } = await fub.get('/textMessages', {
      params: { personId, limit, sort: '-created' },
    });
    return data.textMessages || [];
  } catch (e) { return []; }
}

async function getRecentNotes(personId, limit = 5) {
  try {
    const { data } = await fub.get('/notes', {
      params: { personId, limit, sort: '-created' },
    });
    return data.notes || [];
  } catch (e) { return []; }
}

async function getRecentEmails(personId, limit = 5) {
  try {
    const { data } = await fub.get('/emails', {
      params: { personId, limit, sort: '-created' },
    });
    return data.emails || [];
  } catch (e) { return []; }
}

function buildLeadContext(person, texts = [], notes = [], emails = []) {
  const phones = (person.phones || []).map(p => p.value).join(', ') || 'none';
  const emailAddrs = (person.emails || []).map(e => e.value).join(', ') || 'none';
  const recentTexts = texts.slice(0, 5).reverse()
    .map(t => (t.isIncoming ? person.name : 'Alex') + ': ' + t.message)
    .join('\n') || 'none';
  const recentNotes = notes.slice(0, 3)
    .map(n => '[' + (n.createdBy?.name || 'Staff') + ']: ' + (n.body || '').slice(0, 150))
    .join('\n') || 'none';
  const recentEmails = emails.slice(0, 3)
    .map(e => (e.isIncoming ? person.name : 'Alex') + ' (email): ' + (e.subject || '') + ' — ' + (e.body || '').slice(0, 100))
    .join('\n') || 'none';

  return [
    'Name: '           + (person.name     || 'Unknown'),
    'Phone(s): '       + phones,
    'Email(s): '       + emailAddrs,
    'Stage: '          + (person.stage    || 'unknown'),
    'Source: '         + (person.source   || 'unknown'),
    'Assigned Agent: ' + (person.assignedTo?.name || 'unassigned'),
    'Tags: '           + (person.tags     || []).join(', '),
    '',
    'Recent texts:\n'  + recentTexts,
    '',
    'Recent notes:\n'  + recentNotes,
    '',
    'Recent emails:\n' + recentEmails,
  ].join('\n');
}

// ══════════════════════════════════════════════════════════════════════════════
// ALEX'S FULL FUB TOOLKIT
// Each tool maps 1:1 to a FUB API action Alex can execute
// ══════════════════════════════════════════════════════════════════════════════

const TOOLS = {

  // Send an SMS by controlling FUB's native UI as Alex (bypasses API restrictions)
  send_text: async ({ personId, message }) => {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      // Log in as Alex Reeves
      await page.goto('https://app.followupboss.com/2/login', { waitUntil: 'networkidle2' });
      // Log in using exact FUB selectors (confirmed via debug)
      await page.waitForSelector('#email', { timeout: 10000 });
      await page.type('#email', process.env.ALEX_FUB_EMAIL || 'support@okcreal.com');
      await page.type('#Password', process.env.ALEX_FUB_PASSWORD);
      await page.click('[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });

      // Navigate to the contact
      await page.goto(`https://app.followupboss.com/2/people/view/${personId}`, { waitUntil: 'networkidle2' });
      await page.waitForTimeout(2000);

      // Click the Text tab — try multiple selectors
      try {
        const [textTab] = await page.$x('//a[normalize-space()="Text"] | //button[normalize-space()="Text"] | //span[normalize-space()="Text"]/..');
        if (textTab) await textTab.click();
      } catch(e) {
        await page.click('[data-tab="text"], [href*="text"], [class*="text-tab"]');
      }
      await page.waitForTimeout(1500);

      // Type the message into whatever textarea/contenteditable is visible
      await page.waitForSelector('textarea:not([style*="display: none"]), [contenteditable="true"]', { timeout: 8000 });
      await page.focus('textarea:not([style*="display: none"]), [contenteditable="true"]');
      await page.keyboard.type(message);

      // Click Send button
      const [sendBtn] = await page.$x('//button[normalize-space()="Send"]');
      if (sendBtn) {
        await sendBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(2000);
      return `Sent text to person ${personId} via FUB native UI: "${message.slice(0, 60)}"`;
    } finally {
      await browser.close();
    }
  },

  // Send an email through FUB
  send_email: async ({ personId, subject, body }) => {
    await fub.post('/emails', {
      personId,
      subject,
      htmlBody: body.replace(/\n/g, '<br>'),
      textBody: body,
      isIncoming: false,
    });
    return `Sent email to person ${personId}: "${subject}"`;
  },

  // Post a note (visible in FUB timeline)
  post_note: async ({ personId, body }) => {
    await fub.post('/notes', { personId, body, isHtml: false });
    return `Posted note to person ${personId}`;
  },

  // Add or remove tags on a lead
  update_tags: async ({ personId, addTags = [], removeTags = [] }) => {
    const { data } = await fub.get('/people/' + personId);
    let tags = (data.tags || []).filter(t => !removeTags.includes(t));
    for (const t of addTags) {
      if (!tags.includes(t)) tags.push(t);
    }
    await fub.put('/people/' + personId, { tags });
    return `Updated tags for person ${personId}. Added: [${addTags}] Removed: [${removeTags}]`;
  },

  // Move lead to a different pipeline stage
  update_stage: async ({ personId, stage }) => {
    await fub.put('/people/' + personId, { stage });
    return `Updated stage for person ${personId} to "${stage}"`;
  },

  // Assign lead to a specific agent
  assign_agent: async ({ personId, agentName }) => {
    // Find the agent user ID by name
    const { data: users } = await fub.get('/users', { params: { limit: 50 } });
    const agent = (users.users || []).find(
      u => u.name?.toLowerCase().includes(agentName.toLowerCase())
    );
    if (!agent) throw new Error('Agent not found: ' + agentName);
    await fub.put('/people/' + personId, { assignedTo: { id: agent.id } });
    return `Assigned person ${personId} to agent ${agent.name}`;
  },

  // Create a follow-up task for a person
  create_task: async ({ personId, description, dueInDays = 1 }) => {
    const due = new Date();
    due.setDate(due.getDate() + dueInDays);
    await fub.post('/tasks', {
      personId,
      dueDate:     due.toISOString().split('T')[0],
      note:        description + '\n— Created by Alex Reeves (AI)',
      isCompleted: false,
    });
    return `Created task for person ${personId}: "${description}" due in ${dueInDays} day(s)`;
  },

  // Create an appointment
  create_appointment: async ({ personId, title, datetime, notes = '' }) => {
    await fub.post('/appointments', {
      personId,
      title,
      start: datetime,
      notes: notes + '\n— Created by Alex Reeves (AI)',
    });
    return `Created appointment for person ${personId}: "${title}" at ${datetime}`;
  },

  // Update any basic lead fields (name, address, custom fields, etc.)
  update_person: async ({ personId, fields }) => {
    await fub.put('/people/' + personId, fields);
    return `Updated person ${personId} fields: ${Object.keys(fields).join(', ')}`;
  },

  // Log a call record
  log_call: async ({ personId, note, outcome = 'no_answer', durationSeconds = 0 }) => {
    await fub.post('/calls', {
      personId,
      userId: alexUserId,
      note,
      outcome,
      durationSeconds,
    });
    return `Logged call for person ${personId}: ${outcome}`;
  },

  // Start a follow-up sequence (internal — manages persistent outreach)
  start_followup_sequence: async ({ personId, leadName, goal, messages, intervalHours = 24, maxAttempts = 4 }) => {
    const taskId = 'fu_' + Date.now() + '_' + personId;
    const task = {
      id: taskId, personId, leadName, goal,
      messages, intervalHours, maxAttempts,
      attemptCount: 0, status: 'active',
      timer: null, createdAt: Date.now(),
    };
    activeTasks.set(taskId, task);
    scheduleNextFollowUp(task);
    return `Started follow-up sequence for ${leadName}. Will attempt up to ${maxAttempts} times every ${intervalHours}h. Task ID: ${taskId}`;
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// FOLLOW-UP SEQUENCE MANAGER
// ══════════════════════════════════════════════════════════════════════════════

function scheduleNextFollowUp(task) {
  const delay = task.intervalHours * 60 * 60 * 1000;

  task.timer = setTimeout(async () => {
    const current = activeTasks.get(task.id);
    if (!current || current.status !== 'active') return;

    if (current.attemptCount >= current.maxAttempts) {
      // Exhausted attempts — notify team
      await TOOLS.post_note({
        personId: current.personId,
        body:
          `Alex update: I've reached out to ${current.leadName} ${current.attemptCount} times ` +
          `without a response. Task: "${current.goal}"\n` +
          `Marking as unresponsive — someone may want to try a different channel.\n` +
          `— Alex Reeves (AI)`,
      }).catch(() => {});
      current.status = 'exhausted';
      activeTasks.delete(task.id);
      return;
    }

    // Get a fresh follow-up message
    const recentTexts = await getRecentTexts(current.personId, 6);
    const followUp = await generateFollowUpMessage(current, recentTexts);

    await TOOLS.send_text({ personId: current.personId, message: followUp }).catch(() => {});
    current.attemptCount++;
    current.lastSentAt = Date.now();

    console.log('[Alex] Follow-up attempt', current.attemptCount, 'sent to', current.leadName);
    scheduleNextFollowUp(current);
  }, delay);
}

// ══════════════════════════════════════════════════════════════════════════════
// GROK AI BRAIN
// ══════════════════════════════════════════════════════════════════════════════

const TOOL_SCHEMAS = `
Available tools Alex can call (return a JSON array of tool calls):

1. send_text(personId, message)
   — Send an SMS via FUB's built-in messaging

2. send_email(personId, subject, body)
   — Send an email via FUB

3. post_note(personId, body)
   — Post a note to the FUB timeline (visible to all staff)

4. update_tags(personId, addTags[], removeTags[])
   — Add or remove tags on a lead

5. update_stage(personId, stage)
   — Update lead pipeline stage
   — Common stages: "New Lead", "Attempting Contact", "Active", "Under Contract", "Closed", "Inactive"

6. assign_agent(personId, agentName)
   — Assign lead to a specific agent by name

7. create_task(personId, description, dueInDays)
   — Create a follow-up task

8. create_appointment(personId, title, datetime, notes)
   — Create an appointment (datetime in ISO format)

9. update_person(personId, fields)
   — Update lead fields like { "address": "...", "customFields": [...] }

10. log_call(personId, note, outcome, durationSeconds)
    — Log a call record (outcomes: no_answer, left_voicemail, answered, wrong_number)

11. start_followup_sequence(personId, leadName, goal, messages[], intervalHours, maxAttempts)
    — Start a persistent outreach sequence that sends follow-ups on a schedule
    — messages[] is an array of SMS messages to cycle through
    — Use this when asked to "pursue", "follow up until they respond", etc.
`;

async function decideActions(instruction, personId, leadContext) {
  try {
    const { data } = await axios.post('https://api.x.ai/v1/chat/completions', {
      model: 'grok-3-fast',
      messages: [{ role: 'user', content:
        `You are Alex Reeves, an AI team member at OKC Real property management in Oklahoma City.
A staff member just gave you this instruction via a @alex mention in Follow Up Boss:

"${instruction}"

Lead context:
${leadContext}

Person ID (for all FUB API calls): ${personId}

${TOOL_SCHEMAS}

Based on the instruction and lead context, decide which tools to call and in what order.
Write natural, warm, professional messages that sound like a real helpful person, not a bot.

STRICT RULES:
- post_note may appear AT MOST ONCE in your actions list — one clean summary note only
- Do not post multiple notes under any circumstances
- The completionNote is your ONE note — keep it to 1-2 sentences summarizing what you did
- Do not sign off with "Alex Reeves (AI)" in every sentence — just once at the end of the completionNote

Respond ONLY with a JSON object (no markdown):
{
  "thinking": "brief explanation of your plan",
  "actions": [
    { "tool": "tool_name", "params": { ... } },
    ...
  ],
  "completionNote": "1-2 sentence summary of what Alex did. — Alex Reeves (AI)"
}` }],
      max_tokens: 1200,
    }, { headers: { Authorization: 'Bearer ' + XAI_API_KEY, 'Content-Type': 'application/json' } });

    const raw  = data.choices?.[0]?.message?.content || '{}';
    const clean = raw.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('[Grok] decideActions error:', e.message);
    return null;
  }
}

async function generateFollowUpMessage(task, recentTexts) {
  const history = recentTexts
    .slice(0, 6)
    .reverse()
    .map(t => (t.isIncoming ? task.leadName : 'Alex') + ': ' + t.message)
    .join('\n');

  try {
    const { data } = await axios.post('https://api.x.ai/v1/chat/completions', {
      model: 'grok-3-fast',
      messages: [{ role: 'user', content:
        `You are Alex Reeves, AI team member at OKC Real, Oklahoma City.
You are following up with a lead named ${task.leadName}.
Task goal: ${task.goal}

Recent conversation:
${history || '(no prior messages)'}

Write a short, natural follow-up SMS (1-2 sentences). Warm but not pushy.
Just the message text, nothing else.` }],
      max_tokens: 100,
    }, { headers: { Authorization: 'Bearer ' + XAI_API_KEY, 'Content-Type': 'application/json' } });

    return data.choices?.[0]?.message?.content?.trim() || "Hey, just checking in! Let me know if you have any questions.";
  } catch (e) {
    return "Hi! Just following up — is there anything I can help you with?";
  }
}

async function evaluateIncomingReply(task, reply) {
  try {
    const { data } = await axios.post('https://api.x.ai/v1/chat/completions', {
      model: 'grok-3-fast',
      messages: [{ role: 'user', content:
        `Alex is working on this task: "${task.goal}"
The lead (${task.leadName}) just replied: "${reply}"

Is the task complete, or should Alex keep following up?
Respond JSON only:
{
  "complete": true/false,
  "alexReply": "Alex's response to send the lead (1-2 sentences, warm and natural)",
  "teamNote": "Brief update to post in FUB for the team",
  "suggestedActions": ["any additional tool actions like update_stage or add_tag"]
}` }],
      max_tokens: 300,
    }, { headers: { Authorization: 'Bearer ' + XAI_API_KEY, 'Content-Type': 'application/json' } });

    const raw = data.choices?.[0]?.message?.content || '{}';
    return JSON.parse(raw.replace(/```json\n?|```/g, '').trim());
  } catch (e) {
    return { complete: false, alexReply: "Thanks for getting back to me! How can I help?", teamNote: null };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CORE: HANDLE AN @ALEX MENTION
// ══════════════════════════════════════════════════════════════════════════════

function mentionsAlex(text = '') {
  // Match plain @alex, @Alex Reeves, or FUB's HTML span mention format
  return /@alex\b/i.test(text) ||
         /alex reeves/i.test(text) ||
         /data-user-id="50"/i.test(text);
}

function extractInstruction(text = '') {
  const match = text.match(/@alex[,:]?\s*([\s\S]+)/i);
  return match ? match[1].trim() : text.trim();
}

async function handleMention(noteBody, personId, authorName = 'Team') {
  const instruction = extractInstruction(noteBody);
  console.log('\n[Alex] Task from', authorName, ':', instruction.slice(0, 100));

  // 1. Gather full lead context
  const person  = await getPerson(personId);
  if (!person) {
    console.warn('[Alex] Could not find person', personId);
    return;
  }

  const [texts, notes, emails] = await Promise.all([
    getRecentTexts(personId, 10),
    getRecentNotes(personId, 5),
    getRecentEmails(personId, 5),
  ]);

  const leadContext = buildLeadContext(person, texts, notes, emails);

  // 2. Ask Grok what to do
  const plan = await decideActions(instruction, personId, leadContext);
  if (!plan || !plan.actions?.length) {
    await TOOLS.post_note({
      personId,
      body:
        `Hey ${authorName} — I saw your note but had trouble figuring out what to do for ${person.name}. ` +
        `Could you give me a bit more detail?\n— Alex Reeves (AI)`,
    });
    return;
  }

  console.log('[Alex] Plan:', plan.thinking);
  console.log('[Alex] Actions:', plan.actions.map(a => a.tool).join(', '));

  // 3. Enforce max 1 post_note (code-level safeguard, not just prompt)
  let notesSeen = 0;
  plan.actions = plan.actions.filter(a => {
    if (a.tool === 'post_note') { notesSeen++; return notesSeen <= 1; }
    return true;
  });

  // 4. Execute each action in sequence
  const results = [];
  for (const action of plan.actions) {
    const toolFn = TOOLS[action.tool];
    if (!toolFn) {
      console.warn('[Alex] Unknown tool:', action.tool);
      continue;
    }
    try {
      const result = await toolFn(action.params);
      results.push('✓ ' + result);
      console.log('[Alex]', result);
    } catch (e) {
      results.push('✗ ' + action.tool + ' failed: ' + e.message);
      console.error('[Alex] Tool error:', action.tool, e.message);
    }
  }

  // 4. Post completion note back to FUB so the team sees what Alex did
  if (plan.completionNote) {
    await TOOLS.post_note({
      personId,
      body: plan.completionNote + '\n\n— Alex Reeves (AI)',
    }).catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLE INCOMING REPLY FROM A LEAD
// ══════════════════════════════════════════════════════════════════════════════

async function handleIncomingText(event) {
  const personId = event.data?.personId || event.personId;
  const message  = event.data?.message  || event.message || '';
  if (!personId || !message) return;

  // Find an active follow-up task for this person
  const task = [...activeTasks.values()].find(
    t => t.personId === personId && t.status === 'active'
  );
  if (!task) return;

  console.log('[Alex] Reply from', task.leadName, ':', message.slice(0, 60));

  // Pause follow-ups while evaluating
  if (task.timer) { clearTimeout(task.timer); task.timer = null; }

  const evaluation = await evaluateIncomingReply(task, message);

  // Reply to the lead
  if (evaluation.alexReply) {
    await TOOLS.send_text({ personId, message: evaluation.alexReply }).catch(() => {});
  }

  if (evaluation.complete) {
    // Task done — post update for the team
    await TOOLS.post_note({
      personId,
      body:
        (evaluation.teamNote || `${task.leadName} responded. Task complete.`) +
        `\n\nOriginal task: "${task.goal}"\n— Alex Reeves (AI)`,
    }).catch(() => {});
    activeTasks.delete(task.id);
    console.log('[Alex] Task', task.id, 'completed.');
  } else {
    // Keep pursuing
    task.lastSentAt = Date.now();
    scheduleNextFollowUp(task);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Main FUB webhook endpoint
// In FUB: Admin → API → Webhooks → Add Webhook
// URL: https://your-railway-url/fub-webhook
// Subscribe to: note.created, textMessage.received, email.received
app.post('/fub-webhook', async (req, res) => {
  res.sendStatus(200); // Respond immediately

  const event    = req.body;
  const type     = event?.type || event?.event || '';
  const noteBody = event?.data?.body || event?.body || '';
  const personId = event?.data?.personId || event?.personId;

  try {
    if (type === 'note.created' && mentionsAlex(noteBody) && personId) {
      const authorName = event?.data?.createdBy?.name || 'Team';
      await handleMention(noteBody, String(personId), authorName);

    } else if (type === 'textMessage.received' && personId) {
      await handleIncomingText(event);
    }
  } catch (e) {
    console.error('[Alex] Webhook error:', e.message);
  }
});

// ─── Manual test endpoint ──────────────────────────────────────────────────
// POST /mention {"personId":"12345","instruction":"text this lead about their tour","authorName":"Landon"}
app.post('/mention', async (req, res) => {
  const { personId, instruction, authorName = 'Team' } = req.body;
  if (!personId || !instruction) {
    return res.status(400).json({ error: 'personId and instruction required' });
  }
  res.json({ success: true });
  await handleMention('@alex ' + instruction, String(personId), authorName);
});

// ─── View active follow-up tasks ──────────────────────────────────────────
app.get('/tasks', (req, res) => {
  const tasks = [...activeTasks.values()].map(t => ({
    id: t.id, personId: t.personId, leadName: t.leadName,
    goal: t.goal, status: t.status, attempts: t.attemptCount,
    maxAttempts: t.maxAttempts, createdAt: new Date(t.createdAt).toISOString(),
  }));
  res.json({ count: tasks.length, tasks });
});

// ─── Cancel a follow-up task ───────────────────────────────────────────────
app.delete('/tasks/:id', (req, res) => {
  const task = activeTasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  if (task.timer) clearTimeout(task.timer);
  activeTasks.delete(req.params.id);
  res.json({ success: true });
});

// ─── Status ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    agent:       'Alex Reeves | AI Team Member | OKC Real',
    status:      'online',
    activeTasks: activeTasks.size,
    capabilities: [
      'Send texts via FUB messaging',
      'Send emails via FUB',
      'Post notes to FUB timeline',
      'Add / remove tags',
      'Update lead stage',
      'Assign leads to agents',
      'Create tasks & appointments',
      'Log calls',
      'Persistent follow-up sequences',
    ],
    howToUse: 'Write a FUB note mentioning @alex and describe what you need.',
    examples: [
      '@alex text this lead and find out why they ghosted. Follow up until they respond.',
      '@alex send a welcome email, tag as Hot Lead, and move to Active stage.',
      '@alex this lead went cold — send a re-engagement text and create a follow-up task for next week.',
      '@alex assign this lead to Sarah and leave a note about next steps.',
    ],
    webhook: SERVER_URL + '/fub-webhook',
  });
});


// ─── One-time setup endpoint ──────────────────────────────────────────────
// Visit https://alex-production-1d3b.up.railway.app/setup to register webhook
app.get('/setup', async (req, res) => {
  const webhookUrl = SERVER_URL + '/fub-webhook';
  const ownerKey = OWNER_FUB_API_KEY || ALEX_FUB_API_KEY;
  const ownerFub = axios.create({
    baseURL: 'https://api.followupboss.com/v1',
    auth: { username: ownerKey, password: '' },
    headers: { 'Content-Type': 'application/json', 'X-System': 'Alex Reeves AI', 'X-System-Key': ownerKey },
  });
  try {
    const listRes = await ownerFub.get('/webhooks');
    const existing = (listRes.data.webhooks || []).find(w => w.url === webhookUrl);
    if (existing) {
      return res.json({ status: 'already registered', webhook: webhookUrl });
    }
    await ownerFub.post('/webhooks', {
      url: webhookUrl,
      system: 'Alex Reeves AI',
      events: ['note.created', 'textMessage.received'],
    });
    console.log('Webhook registered via /setup:', webhookUrl);
    res.json({ status: 'registered!', webhook: webhookUrl });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.get('/health', (req, res) =>
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) + 's' })
);

// ─── Polling: check FUB every 10 seconds for new @alex notes ──────────────
const processedNoteIds = new Set();

async function pollForAlexMentions() {
  try {
    // Fetch the 25 most recent notes across all people
    const res = await fub.get('/notes', {
      params: { limit: 25, sort: '-created' }
    });
    const notes = res.data?.notes || [];

    for (const note of notes) {
      const noteId   = String(note.id);
      const body     = note.body || '';
      const personId = note.personId ? String(note.personId) : null;

      // Skip if already processed or doesn't mention @alex
      if (processedNoteIds.has(noteId)) continue;
      if (!mentionsAlex(body)) continue;
      if (!personId) continue;
      // CRITICAL: never process notes written by Alex himself (prevents infinite loop)
      if (note.createdById === 50 || note.createdBy?.id === 50) continue;

      // Mark processed immediately to avoid double-processing
      processedNoteIds.add(noteId);
      // Keep set from growing forever
      if (processedNoteIds.size > 500) {
        const first = processedNoteIds.values().next().value;
        processedNoteIds.delete(first);
      }

      const authorName = note.createdBy?.name || 'Team';
      console.log(`[Alex] @mention found — Note ${noteId}, Person ${personId}, by ${authorName}`);
      handleMention(body, personId, authorName).catch(e =>
        console.error('[Alex] handleMention error:', e.message)
      );
    }
  } catch (e) {
    // Silently ignore transient API errors
    if (e.response?.status !== 429) {
      console.error('[Alex] Poll error:', e.message);
    }
  }
}

app.listen(PORT, async () => {
  console.log('\nAlex Reeves | AI Team Member | OKC Real');
  console.log('Port:', PORT);
  console.log('Mode: Polling every 10 seconds for @alex mentions');
  console.log('');
  console.log('Tools: send_text, send_email, post_note, update_tags,');
  console.log('       update_stage, assign_agent, create_task,');
  console.log('       create_appointment, log_call, start_followup_sequence');
  console.log('');
  console.log('Usage: @alex [any instruction] in any FUB note\n');
  await getAlexUserId();

  // Seed processed set with existing notes so we don't re-process old ones on startup
  try {
    const res = await fub.get('/notes', { params: { limit: 25, sort: '-created' } });
    (res.data?.notes || []).forEach(n => processedNoteIds.add(String(n.id)));
    console.log(`[Alex] Seeded ${processedNoteIds.size} existing notes — polling started.`);
  } catch(e) {
    console.error('[Alex] Seed error:', e.message);
  }

  setInterval(pollForAlexMentions, 10000);
});
