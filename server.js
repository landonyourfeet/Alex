require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());
const { PORT = 3001, ALEX_FUB_API_KEY, SERVER_URL = 'http://localhost:3001', XAI_API_KEY } = process.env;
// PLACEHOLDER - full code will be inserted via commit
app.get('/health', (req, res) => res.json({ status: 'ok' }));
/**
 * Alex Reeves - AI Team Member | OKC Real
  *
   * Alex works inside Follow Up Boss like any other staff member.
    * Mention @alex in any FUB note and describe what you need.
     * He reads the instruction, looks up full lead context, decides which
      * FUB actions to take, and executes them automatically.
       *
        * FULL TOOLKIT:
         *   send_text, send_email, post_note, update_tags, update_stage,
          *   assign_agent, create_task, create_appointment, log_call,
           *   start_followup_sequence
            *
             * EXAMPLES:
              *   "@alex text this lead - find out why they didn't schedule a tour.
               *    Follow up until they respond."
                *
                 *   "@alex send a welcome email, tag as Hot Lead, move to Active stage."
                  *
                   *   "@alex this lead went cold. Re-engagement text + task next week + tag Needs Attention."
                    *
                     *   "@alex assign this lead to Sarah and leave a summary note."
                      *
                       *   "@alex email this lead availability for 123 NW 5th St and ask if they want a showing."
                        *
                         * SETUP:
                          *   1. Create FUB user: Alex Reeves | alex.reeves@okcreal.com | role = Agent
                           *   2. Assign FUB Calling number to Alex (Admin > Calling > Add Number)
                            *   3. Log in as Alex > Admin > API > Generate API Key
                             *   4. Create FUB webhook: https://your-railway-url/fub-webhook
                              *      Events: note.created, textMessage.received
                               *   5. Add env vars in Railway (see .env.example)
                                */

require('dotenv').config();
const express = require('express');
const axios   = require('axios');

const app = express();
app.use(express.json());

const {
      PORT           = 3001,
      ALEX_FUB_API_KEY,
      SERVER_URL     = 'http://localhost:3001',
      XAI_API_KEY,
} = process.env;

const fub = axios.create({
      baseURL: 'https://api.followupboss.com/v1',
      auth:    { username: ALEX_FUB_API_KEY, password: '' },
      headers: { 'Content-Type': 'application/json' },
});

const activeTasks = new Map();
let alexUserId = null;

// FUB DATA HELPERS

async function getAlexUserId() {
      if (alexUserId) return alexUserId;
      try {
              const { data } = await fub.get('/identity');
              alexUserId = data.id;
              return alexUserId;
      } catch (e) { console.error('[Alex] identity:', e.message); return null; }
}

async function getPerson(personId) {
      try { const { data } = await fub.get('/people/' + personId); return data; }
      catch (e) { return null; }
}

async function getRecentTexts(personId, limit = 10) {
      try {
              const { data } = await fub.get('/textMessages', { params: { personId, limit, sort: '-created' } });
              return data.textMessages || [];
      } catch (e) { return []; }
}

async function getRecentNotes(personId, limit = 5) {
      try {
              const { data } = await fub.get('/notes', { params: { personId, limit, sort: '-created' } });
              return data.notes || [];
      } catch (e) { return []; }
}

async function getRecentEmails(personId, limit = 5) {
      try {
              const { data } = await fub.get('/emails', { params: { personId, limit, sort: '-created' } });
              return data.emails || [];
      } catch (e) { return []; }
}

function buildLeadContext(person, texts = [], notes = [], emails = []) {
      const phones     = (person.phones || []).map(p => p.value).join(', ') || 'none';
      const emailAddrs = (person.emails || []).map(e => e.value).join(', ') || 'none';
      const recentTexts = texts.slice(0, 5).reverse()
              .map(t => (t.isIncoming ? person.name : 'Alex') + ': ' + t.message)
              .join('\n') || 'none';
      const recentNotes = notes.slice(0, 3)
              .map(n => '[' + (n.createdBy?.name || 'Staff') + ']: ' + (n.body || '').slice(0, 150))
              .join('\n') || 'none';
      const recentEmails = emails.slice(0, 3)
              .map(e => (e.isIncoming ? person.name : 'Alex') + ' (email): ' + (e.subject || '') + ' - ' + (e.body || '').slice(0, 100))
              .join('\n') || 'none';
    
      return [
              'Name: '           + (person.name     || 'Unknown'),
              'Phone(s): '       + phones,
              'Email(s): '       + emailAddrs,
              'Stage: '          + (person.stage    || 'unknown'),
              'Source: '         + (person.source   || 'unknown'),
              'Assigned Agent: ' + (person.assignedTo?.name || 'unassigned'),
              'Tags: '           + (person.tags || []).join(', '),
              '',
              'Recent texts:\n'  + recentTexts,
              '',
              'Recent notes:\n'  + recentNotes,
              '',
              'Recent emails:\n' + recentEmails,
            ].join('\n');
}

// ALEX'S FULL FUB TOOLKIT
// Each tool is a direct FUB API action Alex can call

const TOOLS = {
    
      send_text: async ({ personId, message }) => {
              await fub.post('/textMessages', { personId, message, isIncoming: false });
              return 'Sent text: "' + message.slice(0, 60) + '"';
      },
    
      send_email: async ({ personId, subject, body }) => {
              await fub.post('/emails', {
                        personId, subject,
                        htmlBody: body.replace(/\n/g, '<br>'),
                        textBody: body,
                        isIncoming: false,
              });
              return 'Sent email: "' + subject + '"';
      },
    
      post_note: async ({ personId, body }) => {
              await fub.post('/notes', { personId, body, isHtml: false });
              return 'Posted note';
      },
    
      update_tags: async ({ personId, addTags = [], removeTags = [] }) => {
              const { data } = await fub.get('/people/' + personId);
              let tags = (data.tags || []).filter(t => !removeTags.includes(t));
              for (const t of addTags) { if (!tags.includes(t)) tags.push(t); }
              await fub.put('/people/' + personId, { tags });
              return 'Tags updated. Added: [' + addTags + '] Removed: [' + removeTags + ']';
      },
    
      update_stage: async ({ personId, stage }) => {
              await fub.put('/people/' + personId, { stage });
              return 'Stage updated to "' + stage + '"';
      },
    
      assign_agent: async ({ personId, agentName }) => {
              const { data: users } = await fub.get('/users', { params: { limit: 50 } });
              const agent = (users.users || []).find(u => u.name?.toLowerCase().includes(agentName.toLowerCase()));
              if (!agent) throw new Error('Agent not found: ' + agentName);
              await fub.put('/people/' + personId, { assignedTo: { id: agent.id } });
              return 'Assigned to ' + agent.name;
      },
    
      create_task: async ({ personId, description, dueInDays = 1 }) => {
              const due = new Date();
              due.setDate(due.getDate() + dueInDays);
              await fub.post('/tasks', {
                        personId,
                        dueDate:     due.toISOString().split('T')[0],
                        note:        description + '\n- Created by Alex Reeves (AI)',
                        isCompleted: false,
              });
              return 'Task created: "' + description + '" due in ' + dueInDays + 'd';
      },
    
      create_appointment: async ({ personId, title, datetime, notes = '' }) => {
              await fub.post('/appointments', {
                        personId, title, start: datetime,
                        notes: notes + '\n- Created by Alex Reeves (AI)',
              });
              return 'Appointment created: "' + title + '"';
      },
    
      update_person: async ({ personId, fields }) => {
              await fub.put('/people/' + personId, fields);
              return 'Person updated: ' + Object.keys(fields).join(', ');
      },
    
      log_call: async ({ personId, note, outcome = 'no_answer', durationSeconds = 0 }) => {
              await fub.post('/calls', { personId, note, outcome, durationSeconds });
              return 'Call logged: ' + outcome;
      },
    
      start_followup_sequence: async ({ personId, leadName, goal, messages = [], intervalHours = 24, maxAttempts = 4 }) => {
              const taskId = 'fu_' + Date.now() + '_' + personId;
              const task = {
                        id: taskId, personId, leadName, goal,
                        messages, intervalHours, maxAttempts,
                        attemptCount: 0, status: 'active',
                        timer: null, createdAt: Date.now(),
              };
              activeTasks.set(taskId, task);
              scheduleNextFollowUp(task);
              return 'Follow-up sequence started for ' + leadName + '. Task: ' + taskId;
      },
};

// FOLLOW-UP SEQUENCE MANAGER

function scheduleNextFollowUp(task) {
      task.timer = setTimeout(async () => {
              const current = activeTasks.get(task.id);
              if (!current || current.status !== 'active') return;
          
              if (current.attemptCount >= current.maxAttempts) {
                        await TOOLS.post_note({
                                    personId: current.personId,
                                    body: 'Alex update: Reached out to ' + current.leadName + ' ' + current.attemptCount + ' times with no response.\n' +
                                                      'Task: "' + current.goal + '"\nSomeone may want to try a different approach.\n- Alex Reeves (AI)',
                        }).catch(() => {});
                        current.status = 'exhausted';
                        activeTasks.delete(task.id);
                        return;
              }
          
              const recentTexts = await getRecentTexts(current.personId, 6);
              const msg = await generateFollowUpMessage(current, recentTexts);
              await TOOLS.send_text({ personId: current.personId, message: msg }).catch(() => {});
              current.attemptCount++;
              current.lastSentAt = Date.now();
              console.log('[Alex] Follow-up attempt', current.attemptCount, 'sent to', current.leadName);
              scheduleNextFollowUp(current);
      }, task.intervalHours * 60 * 60 * 1000);
}

// GROK AI BRAIN

const TOOL_SCHEMAS = `Available tools Alex can use:
1. send_text(personId, message) - SMS via FUB built-in messaging
2. send_email(personId, subject, body) - Email via FUB
3. post_note(personId, body) - Note on FUB timeline (visible to all staff)
4. update_tags(personId, addTags[], removeTags[]) - Add or remove tags
5. update_stage(personId, stage) - Pipeline stage: "New Lead","Attempting Contact","Active","Under Contract","Closed","Inactive"
6. assign_agent(personId, agentName) - Assign to agent by name
7. create_task(personId, description, dueInDays) - Create a follow-up task
8. create_appointment(personId, title, datetime, notes) - Create appointment (ISO datetime)
9. update_person(personId, fields) - Update lead fields
10. log_call(personId, note, outcome, durationSeconds) - Log call (outcomes: no_answer, left_voicemail, answered, wrong_number)
11. start_followup_sequence(personId, leadName, goal, messages[], intervalHours, maxAttempts) - Persistent follow-up until response`;

async function decideActions(instruction, personId, leadContext) {
      try {
              const { data } = await axios.post('https://api.x.ai/v1/chat/completions', {
                        model: 'grok-3-fast',
                        messages: [{ role: 'user', content:
                                    'You are Alex Reeves, an AI team member at OKC Real property management in Oklahoma City.\n' +
                                    'A staff member just gave you this instruction via @alex mention in Follow Up Boss:\n\n' +
                                    '"' + instruction + '"\n\n' +
                                    'Lead context:\n' + leadContext + '\n\n' +
                                    'Person ID for all API calls: ' + personId + '\n\n' +
                                    TOOL_SCHEMAS + '\n\n' +
                                    'Decide which tools to call and in what order. Be thorough - do everything implied by the instruction.\n' +
                                    'Write natural, warm, professional messages that sound like a real helpful person, not a bot.\n\n' +
                                    'Respond ONLY with JSON (no markdown):\n' +
                                    '{\n' +
                                    '  "thinking": "brief plan",\n' +
                                    '  "actions": [{"tool": "tool_name", "params": {...}}, ...],\n' +
                                    '  "completionNote": "note to post back to team when done"\n' +
                                    '}' }],
                        max_tokens: 1200,
              }, { headers: { Authorization: 'Bearer ' + XAI_API_KEY, 'Content-Type': 'application/json' } });
          
              const raw = data.choices?.[0]?.message?.content || '{}';
              return JSON.parse(raw.replace(/```json\n?|```/g, '').trim());
      } catch (e) { console.error('[Grok] decideActions:', e.message); return null; }
}

async function generateFollowUpMessage(task, recentTexts) {
      const history = recentTexts.slice(0, 6).reverse()
              .map(t => (t.isIncoming ? task.leadName : 'Alex') + ': ' + t.message)
              .join('\n');
      try {
              const { data } = await axios.post('https://api.x.ai/v1/chat/completions', {
                        model: 'grok-3-fast',
                        messages: [{ role: 'user', content:
                                    'You are Alex Reeves, AI team member at OKC Real, Oklahoma City.\n' +
                                    'Following up with ' + task.leadName + '.\nGoal: ' + task.goal + '\n\n' +
                                    'Recent texts:\n' + (history || '(none)') + '\n\n' +
                                    'Write a short casual follow-up SMS (1-2 sentences). Warm, not pushy. Just the message text.' }],
                        max_tokens: 100,
              }, { headers: { Authorization: 'Bearer ' + XAI_API_KEY, 'Content-Type': 'application/json' } });
              return data.choices?.[0]?.message?.content?.trim() || "Hey, just checking in - any questions I can help with?";
      } catch (e) { return "Hi! Just following up. Let me know if I can help!"; }
}

async function evaluateIncomingReply(task, reply) {
      try {
              const { data } = await axios.post('https://api.x.ai/v1/chat/completions', {
                        model: 'grok-3-fast',
                        messages: [{ role: 'user', content:
                                    'Alex task: "' + task.goal + '"\nLead ' + task.leadName + ' replied: "' + reply + '"\n\n' +
                                    'Is the task complete?\nJSON only: {"complete": bool, "alexReply": "response to lead (1-2 sentences)", "teamNote": "update for team"}' }],
                        max_tokens: 200,
              }, { headers: { Authorization: 'Bearer ' + XAI_API_KEY, 'Content-Type': 'application/json' } });
              const raw = data.choices?.[0]?.message?.content || '{}';
              return JSON.parse(raw.replace(/```json\n?|```/g, '').trim());
      } catch (e) { return { complete: false, alexReply: "Thanks for getting back to me! How can I help?", teamNote: null }; }
}

// CORE HANDLERS

function mentionsAlex(text = '') { return /@alex\b/i.test(text); }
function extractInstruction(text = '') {
      const m = text.match(/@alex[,:]?\s*([\s\S]+)/i);
      return m ? m[1].trim() : text.trim();
}

async function handleMention(noteBody, personId, authorName = 'Team') {
      const instruction = extractInstruction(noteBody);
      console.log('\n[Alex] Task from', authorName, ':', instruction.slice(0, 100));
    
      const person = await getPerson(personId);
      if (!person) { console.warn('[Alex] Person not found:', personId); return; }
    
      const [texts, notes, emails] = await Promise.all([
              getRecentTexts(personId, 10),
              getRecentNotes(personId, 5),
              getRecentEmails(personId, 5),
            ]);
    
      const leadContext = buildLeadContext(person, texts, notes, emails);
      const plan = await decideActions(instruction, personId, leadContext);
    
      if (!plan || !plan.actions?.length) {
              await TOOLS.post_note({
                        personId,
                        body: 'Hey ' + authorName + ' - I saw your note but had trouble figuring out what to do for ' +
                                        person.name + '. Could you give me a bit more detail?\n- Alex Reeves (AI)',
              });
              return;
      }
    
      console.log('[Alex] Plan:', plan.thinking);
      console.log('[Alex] Actions:', plan.actions.map(a => a.tool).join(', '));
    
      for (const action of plan.actions) {
              const fn = TOOLS[action.tool];
              if (!fn) { console.warn('[Alex] Unknown tool:', action.tool); continue; }
              try {
                        const result = await fn(action.params);
                        console.log('[Alex]', result);
              } catch (e) {
                        console.error('[Alex] Tool error:', action.tool, e.message);
              }
      }
    
      if (plan.completionNote) {
              await TOOLS.post_note({
                        personId,
                        body: plan.completionNote + '\n\n- Alex Reeves (AI)',
              }).catch(() => {});
      }
}

async function handleIncomingText(event) {
      const personId = event.data?.personId || event.personId;
      const message  = event.data?.message  || event.message || '';
      if (!personId || !message) return;
    
      const task = [...activeTasks.values()].find(t => t.personId === personId && t.status === 'active');
      if (!task) return;
    
      console.log('[Alex] Reply from', task.leadName, ':', message.slice(0, 60));
    
      if (task.timer) { clearTimeout(task.timer); task.timer = null; }
    
      const evaluation = await evaluateIncomingReply(task, message);
    
      if (evaluation.alexReply) {
              await TOOLS.send_text({ personId, message: evaluation.alexReply }).catch(() => {});
      }
    
      if (evaluation.complete) {
              await TOOLS.post_note({
                        personId,
                        body: (evaluation.teamNote || task.leadName + ' responded. Task complete.') +
                                        '\nTask: "' + task.goal + '"\n- Alex Reeves (AI)',
              }).catch(() => {});
              activeTasks.delete(task.id);
              console.log('[Alex] Task', task.id, 'completed.');
      } else {
              task.lastSentAt = Date.now();
              scheduleNextFollowUp(task);
      }
}

// ROUTES

// FUB Webhook - In FUB: Admin > API > Webhooks > Add Webhook
// URL: https://your-railway-url/fub-webhook
// Subscribe to: note.created, textMessage.received
app.post('/fub-webhook', async (req, res) => {
      res.sendStatus(200);
      const event    = req.body;
      const type     = event?.type || event?.event || '';
      const noteBody = event?.data?.body || event?.body || '';
      const personId = event?.data?.personId || event?.personId;
      try {
              if (type === 'note.created' && mentionsAlex(noteBody) && personId) {
                        await handleMention(noteBody, String(personId), event?.data?.createdBy?.name || 'Team');
              } else if (type === 'textMessage.received' && personId) {
                        await handleIncomingText(event);
              }
      } catch (e) { console.error('[Alex] Webhook error:', e.message); }
});

// Manual test: POST /mention {"personId":"123","instruction":"text this lead","authorName":"Landon"}
app.post('/mention', async (req, res) => {
      const { personId, instruction, authorName = 'Team' } = req.body;
      if (!personId || !instruction) return res.status(400).json({ error: 'personId and instruction required' });
      res.json({ success: true });
      await handleMention('@alex ' + instruction, String(personId), authorName);
});

app.get('/tasks', (req, res) => {
      const tasks = [...activeTasks.values()].map(t => ({
              id: t.id, personId: t.personId, leadName: t.leadName,
              goal: t.goal, status: t.status, attempts: t.attemptCount,
              maxAttempts: t.maxAttempts,
      }));
      res.json({ count: tasks.length, tasks });
});

app.delete('/tasks/:id', (req, res) => {
      const task = activeTasks.get(req.params.id);
      if (!task) return res.status(404).json({ error: 'not found' });
      if (task.timer) clearTimeout(task.timer);
      activeTasks.delete(req.params.id);
      res.json({ success: true });
});

app.get('/', (req, res) => res.json({
      agent: 'Alex Reeves | AI Team Member | OKC Real',
      status: 'online',
      activeTasks: activeTasks.size,
      tools: ['send_text','send_email','post_note','update_tags','update_stage','assign_agent','create_task','create_appointment','log_call','start_followup_sequence'],
      usage: 'Write a FUB note with @alex and describe what you need.',
      examples: [
              '@alex text this lead - find out why they ghosted. Follow up until they respond.',
              '@alex send welcome email, tag Hot Lead, move to Active stage.',
              '@alex assign to Sarah and leave a summary note.',
              '@alex this lead went cold. Re-engagement text + task next week + tag Needs Attention.',
            ],
      webhook: SERVER_URL + '/fub-webhook',
}));

app.get('/health', (req, res) =>
      res.json({ status: 'ok', uptime: Math.round(process.uptime()) + 's' })
    );

app.listen(PORT, async () => {
      console.log('\nAlex Reeves | AI Team Member | OKC Real');
      console.log('Port:', PORT, '| Webhook:', SERVER_URL + '/fub-webhook');
      console.log('Tools: send_text, send_email, post_note, update_tags, update_stage,');
      console.log('       assign_agent, create_task, create_appointment, log_call, start_followup_sequence');
      console.log('Usage: @alex [instruction] in any FUB note\n');
      await getAlexUserId();
});app.listen(PORT, () => console.log('Alex on port', PORT));
