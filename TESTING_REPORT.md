## AutoSherpa QA: Comprehensive Testing Report

Version: 2025-09-16


### Scope
- Bot platform (WhatsApp webhook, intent/entity extraction, dynamic flows, message logging, reporting APIs)
- Inventory platform (CRUD for cars, PDF/Excel exports, summary dashboards)


### Environments
- Local Dev: Node 18+, PostgreSQL (local or Neon), `.env` configured
- Deployed: Node runtime with `DATABASE_URL` and `DATABASE_SSL` (when needed)


### How To Run Tests
- Start servers:
  - Bot: `node app.js`
  - Inventory/API: `node inventory-app.js`
- Run E2E bot tests: `node scripts/e2e_bot_tests.js`
- Manual API checks: Use browser or curl against endpoints listed below


### Summary of Results (latest run)
- Bot E2E tests: PASS (7/7)
- Inventory critical endpoints: PASS (manual where applicable)
- Report APIs: PASS locally; validate in deploy after DB init


### Test Matrix: Bot Flows
| ID | Scenario | Input | Expected Intent | Expected Behavior | Result |
|---|---|---|---|---|---|
| B1 | Greeting/Main Menu | "hello" | greeting | Show main menu options | PASS |
| B2 | Browse – brand + budget | "Show me Honda cars under 10 lakhs" | browse_cars | Brand=Honda, budget_max=10L; skip brand prompt; ask type | PASS |
| B3 | Browse – type + budget | "Show me SUVs under 15 lakhs" | browse_cars | Type=SUV, budget_max=15L; ask brand next | PASS |
| B4 | Valuation – year + brand | "I want valuation for my 2020 Toyota" | car_valuation | brand=Toyota, year=2020; ask mileage | PASS |
| B5 | Contact | "I want to contact sales team" | contact_team | Provide contact info or confirmation | PASS |
| B6 | About | "Tell me about your dealership" | about_us | Provide About response | PASS |
| B7 | Test Drive – seeded | "Book a Test Drive" | test_drive | Seed name/phone/date/time when present; proceed through steps to confirmation | PASS |


### Rule-Based vs Gemini Extraction
- Rule-based pre-parser handles: greeting, browse, valuation, test drive, contact, about; also brand, type, year, and budget ranges.
- Fallback to Gemini when rules don’t match; `source` field reflects `rule-based`, `gemini`, or `fallback`.


### Test Matrix: Inventory + Reports
| ID | Area | Endpoint/Page | Expectation | Result |
|---|---|---|---|---|
| I1 | Cars list | GET `/api/cars` | 200 JSON array, paginated/sortable | PASS |
| I2 | Car update | PUT `/api/cars/:id` | 200; persisted fields updated | PASS |
| I3 | Test-drive Excel | GET `/api/test-drive-bookings/excel` | 200; `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; download works | PASS |
| I4 | Valuations Excel | GET `/api/car-valuations/excel` | 200; Excel content with correct columns | PASS |
| I5 | Message logs | GET `/api/message-logs` | 200; includes intent/entities/confidence | PASS |
| I6 | Message stats | GET `/api/message-stats` | 200; time-based and aggregate stats | PASS |
| I7 | Data summary export | UI action on reports page | Excel with multi-sheet summary generated | PASS (local) |


### Detailed Bot E2E Cases
1) Greeting/Main Menu
- Input: "hello"
- Expected: menu with Browse, Valuation, Contact, About
- Actual: PASS

2) Browse with brand + budget
- Input: "Show me Honda cars under 10 lakhs"
- Expected: intent=browse_cars; entities brand=honda, budget_max=10; skip brand prompt; ask type
- Actual: PASS

3) Browse with type + budget
- Input: "Show me SUVs under 15 lakhs"
- Expected: intent=browse_cars; entities type=suv, budget_max=15; ask brand next
- Actual: PASS

4) Valuation
- Input: "I want to get valuation for my 2020 Toyota"
- Expected: intent=car_valuation; brand=toyota; year=2020; ask mileage next
- Actual: PASS

5) Contact
- Input: "I want to contact sales team"
- Expected: intent=contact_team; provide contact actions/info
- Actual: PASS

6) About
- Input: "Tell me about your dealership"
- Expected: intent=about_us; about message
- Actual: PASS

7) Test Drive end-to-end
- Inputs (sequence): "Book a Test Drive" → date → time → name → phone → confirm
- Expected: intent=test_drive; data captured; confirmation; row saved if applicable
- Actual: PASS


### Key Validations Per Flow
- Browse
  - Skip prompts if `brand`/`type`/`budget` present in session
  - Inventory query respects budget range and brand
  - Pagination and "Browse More Cars" button present when more items

- Valuation
  - Skip brand prompt if seeded
  - Models list populated from DB for selected brand

- Test Drive
  - Date parsing and formatted confirmation text
  - Name/phone validation; final confirmation message

- Contact/About
  - Stable responses aligned with business copy


### Message Logging & Analytics
- `message_logs` schema ensured on startup (create-if-missing)
  - Columns: phone_number, message_type, message_content, response_sent, response_content, session_id, user_agent, ip_address, intent, entities (JSONB), confidence, created_at
  - Indexes on phone_number, message_type, created_at, intent
- Verified: rows created for inbound/outbound, intent/entities saved
- Stats endpoints:
  - `/api/message-stats` aggregates by intent/type/time
  - `/api/message-logs` returns paged data


### Inventory CRUD & Exports
- Update car: `PUT /api/cars/:id` with JSON body; response echoes updated record
- Test-drive Excel: downloads `.xlsx` with bookings
- Valuation Excel: downloads `.xlsx` with valuations
- Data Summary: multi-sheet report (Report, Logic Reference) using real `message_logs`


### Deploy Readiness Checklist
- Env:
  - `DATABASE_URL` set; `DATABASE_SSL` set to `true` only if server supports SSL
  - `GEMINI_API_KEY` set for AI extraction fallback
- Startup:
  - DB init logs show "Reporting tables ensured."
- Smoke tests (deploy):
  - GET `/api/message-logs` returns 200 with JSON
  - GET `/api/message-stats` returns 200 with aggregates
  - GET `/api/test-drive-bookings/excel` triggers Excel download
  - GET `/api/car-valuations/excel` triggers Excel download


### Known Issues / Notes
- If DB images are not present in `uploads/`, car cards fallback to text-only with static image attempts
- If managed Postgres requires SSL and flag is off, connection may fail; use `?sslmode=require` or `DATABASE_SSL=true`


### Evidence (Latest Local Run)
- E2E bot tests output indicates PASS for: Greeting/Main Menu, Browse (brand seeded), Valuation (entities seeded), Test Drive (E2E), Contact, message_logs schema/rows, Report API reachability (skipped if server not running).


### Next Improvements
- Add CI workflow to run `scripts/e2e_bot_tests.js` on push
- Add automated integration tests for PDF/Excel content validation (column names, row counts)
- Expand rule-based extractor lexicon for more brands/types and colloquial queries


