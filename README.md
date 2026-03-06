# Alex Reeves — AI Leasing Assistant | OKC Real

Alex is an AI staff member in Follow Up Boss. He texts prospects after self-guided tours, gathers feedback, logs maintenance issues, and posts full conversation notes — all appearing naturally as Alex in the team timeline.

## What Alex Does

- **Touch 1** — Texts the prospect immediately when AppFolio guest card arrives
- - **Touch 2** — Follows up next morning at 10am CST
  - - **2-Way SMS** — Grok AI handles the full conversation
    - - **MMS Photos** — Accepts property photos, interprets maintenance issues
      - - **FUB Notes** — Posts full feedback notes under Alex's name
        - - **Maintenance Tasks** — Auto-creates FUB tasks if issues are reported
          - - **Pause Tag** — Any staff member adds `Alex Pause` tag → Alex goes completely silent
           
            - ## Setup
           
            - ### 1. Create Alex's FUB Account
            - - Name: **Alex Reeves**
              - - Email: alex.reeves@okcreal.com
                - - Role: Agent
                  - - Go to Admin → Calling → assign a Twilio number to Alex
                   
                    - ### 2. Get Alex's API Key
                    - - Log in as Alex → Admin → API → Generate Key
                      - - Add as `ALEX_FUB_API_KEY` in Railway env vars
                       
                        - ### 3. Environment Variables
                        - Copy `.env.example` to `.env` and fill in all values. Add the same to Railway.
                       
                        - ### 4. Twilio Webhook
                        - Point Alex's number inbound SMS to:
                        - ```
                          https://your-service.railway.app/sms
                          ```

                          ### 5. Gmail Filter for AppFolio Guest Cards
                          - Filter: `from:guestcards@appfolio.com`
                          - - Forward to SendGrid Inbound Parse
                            - - SendGrid posts to: `https://your-service.railway.app/guest-card`
                             
                              - ### 6. Test Alex
                              - ```bash
                                curl -X POST https://your-service.railway.app/test \
                                  -H "Content-Type: application/json" \
                                  -d '{"name":"Test Person","phone":"4055551234","address":"123 Main St"}'
                                ```

                                ## Pause Tag
                                Any team member adds **`Alex Pause`** to a FUB contact → Alex goes completely silent on that contact.

                                ## Tags Alex Uses
                                | Tag | Meaning |
                                |-----|---------|
                                | `Alex Pause` | Staff-controlled — Alex goes silent |
                                | `Alex Showing Sent` | Follow-up already sent |
                                | `Alex Needs Human` | Alex flagged for team attention |
                                | `Alex Interested` | Prospect expressed strong interest |
                                | `Alex Maintenance` | Prospect reported a maintenance issue |

                                ## Deploy to Railway
                                1. Connect this repo to a new Railway service
                                2. 2. Add all env vars from `.env.example`
                                   3. 3. Railway auto-deploys on every push to main
                                     
                                      4. ## Team Talking Points
                                      5. > "Alex Reeves is an AI assistant. He texts prospects after tours and gathers feedback. Add the **Alex Pause** tag to any contact and he stops immediately."
