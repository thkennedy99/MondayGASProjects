# Guidewire Tech Alliances - Monday.com Board Architecture & Usage

## Executive Summary

Guidewire Technology Alliances uses Monday.com as its central project management and partner relationship platform. The system spans **56+ boards** organized into five functional categories, all integrated with a Google Apps Script web application ("Alliance Manager Portal") that syncs board data to Google Sheets for reporting, dashboards, and workflow automation.

---

## Board Architecture Overview

```
                        ┌──────────────────────────────────┐
                        │    PRIMARY PARTNER BOARD          │
                        │    (Dashboard - 8705508201)       │
                        │    43 partners, health metrics    │
                        └──────┬──────────────┬────────────┘
                               │              │
              ┌────────────────▼──┐     ┌─────▼───────────────┐
              │  PARTNER ACTIVITY  │     │  CUSTOMER PIPELINE   │
              │  BOARDS (43)       │     │  BOARDS (8)          │
              │  Joint GW/Partner  │     │  Joint customer      │
              │  task tracking     │     │  tracking             │
              └────────────────────┘     └──────────────────────┘

    ┌─────────────────────────────┐     ┌──────────────────────────────┐
    │  GW INTERNAL BOARDS (4)     │     │  MARKETING BOARDS (3)        │
    │  Partner Mgmt | Tech Ops    │     │  Event Approvals (2025)      │
    │  Marketing    | Marketplace │     │  Event Approvals (2026)      │
    │  Internal task assignment    │     │  Marketing Event Calendar    │
    └─────────────────────────────┘     └──────────────────────────────┘
```

---

## 1. Primary Partner Board (Partner Dashboard)

**Board:** Primary Partner Board
**Board ID:** `8705508201`
**Purpose:** Central hub providing a high-level view of all 43 technology partners. Acts as the master registry linking to each partner's dedicated activity board and (where applicable) customer pipeline board.

### Structure

| Column | Type | Purpose |
|--------|------|---------|
| Name | name | Partner company name |
| Subitems | subtasks | Linked subitems |
| Status | status | Onboarding stage: `Activated`, `Onboarded`, `Not Saved` |
| Temperature | status | Relationship health: `Very Green`, `Green`, `Yellow`, `Red`, `Critical`, `Terminated`, `NA` |
| Engagement | status | Interaction frequency: `Very Active`, `Active`, `Occasional`, `Disengaged`, `N/A` |
| Files | file | Attached documents |
| AllianceManager | status | Assigned AM: 11 team members |
| Summary of Partner Activities | long_text | Free-text notes on current partner status and highlights |
| PartnerBoard | text | Board ID linking to the partner's dedicated activity board |
| CustomerBoard | text | Board ID linking to the partner's customer pipeline board |
| MarketingLevel | status | Partner tier: `Fuel` (top 12), `Strategic`, `High`, `Medium` |

### Groups
- **Partners** - Single group containing all 43 active partner entries

### Current Partner Roster (43 Partners)

**Fuel Tier (Top 12):** Indico Data, Hi Marley, Genesys, Appian, Perforce, Box, Verisk, Smarty, LexisNexis, Akur8, Mitchell, Newgen

**Strategic Tier:** Swiss Re, SmartComms, Shift Technology, One Inc, Docusign

**High Tier:** Stripe, Snowflake, Sailpoint, OpenText, Nearmap, Hertz, GhostDraft, FRISS, EvolutionIQ, Databricks, Copart, CCC, Audatex, Applied Systems/IVANS, AAIS, AWS, AgentSync, Earnix, CoreLogic, HyperExponential, WTW, Whatfix

**Medium Tier:** Transcard, Precisely, Appulate, Blue Prism

### Alliance Manager Assignments
Partners are distributed across 11 alliance managers: Aaron Shaw, Eric Apse, Fatima Aoulagha-Bannou, Gregg Rabenold, Kelly Clayton, Ketaki Padhye, Leon Liberman, Lisa Vingerhoet, Paul Harper, Shannon Spies, Tim Kennedy.

---

## 2. Partner Activity Boards (43 Boards)

**Purpose:** Joint project management between Guidewire and each technology partner. These are the day-to-day operational boards where both Guidewire alliance managers and partner contacts track tasks, deliverables, and milestones collaboratively.

### Template Schema (12 columns, consistent across all 43 boards)

| Column | Column ID | Type | Purpose |
|--------|-----------|------|---------|
| Name | `name` | name | Task/activity name |
| Subitems | `subtasks_mkp7am7a`* | subtasks | Subtask breakdown |
| Comments/Notes | `status_1_mkn1ekgr` | long_text | Activity notes and context |
| Activity Status | `color_mktakkpw`* | status | Current state of the task |
| Owner | `dropdown_mkt9wrne`* | dropdown | Responsible party (cross-org) |
| Importance | `color_mkt9mypk`* | status | Priority level |
| Activity | `color_mkt9t32b`* | status | Category of work |
| Date Created | `date_1_mkn1x66b` | date | When the task was created |
| Date Due | `date_1_mkn1rbp8` | date | Target completion date |
| Actual Completion | `dup__of_date_due_mkn1zx06` | date | When actually completed |
| Files | `files_mkn15ep0` | file | Attached documents |
| Partner Name | `status_1_mkn1xbbx` | status | Auto-set to the partner's marketplace name |

*Column IDs vary slightly on older boards (e.g., Whatfix uses `color_mktaqa3h` for Activity Status instead of `color_mktakkpw`), but the column titles and label values are consistent.

Some boards also include:
- **Link** (`link_mkxxz6cx`) - URL reference

### Groups (consistent across all partner boards)
- **Open Items** - Active tasks currently in progress or pending
- **Completed Items** - Finished tasks (archived but retained for history)
- **Pipeline** - Future planned activities not yet started

### Status Labels

**Activity Status:**
| Index | Label | Description |
|-------|-------|-------------|
| 0 | Not Started | Task created but work hasn't begun |
| 1 | Blockers | Work is blocked by a dependency or issue |
| 2 | In Progress | Actively being worked on |
| 3 | Ongoing | Recurring or continuous activity |
| 4 | Halted | Paused intentionally |
| 5 | Not Started | (duplicate of 0 - default) |
| 6 | SOLD | Related to a customer sale/win |
| 7 | Other | Miscellaneous |
| 8 | Guidewire PD | Requires Guidewire Product Development involvement |
| 9 | Training | Training-related activity |
| 10 | Completed | Task finished |

**Importance:**
| Index | Label |
|-------|-------|
| 0 | 1. Urgent |
| 1 | 2. High |
| 2 | 3. Medium |
| 3 | 4. Low |
| 5 | 5. N/A |

**Owner (Cross-Organization Dropdown):**
This is a key differentiator from the GW internal boards. Owner values reflect the collaborative nature of these boards:

| Option | Description |
|--------|-------------|
| GW Alliances | Guidewire Alliance Manager |
| Partner Alliances | Partner's alliance/partnership team |
| GW CSM | Guidewire Customer Success Manager |
| GW Solution Consulting | Guidewire pre-sales/solution architect |
| GW Tech Team | Guidewire technical team |
| Partner Tech | Partner's technical/engineering team |
| Partner Marketing | Partner's marketing team |
| GW Marketing | Guidewire marketing team |
| GW Marketplace | Guidewire marketplace team |
| GW GSC BBG/RFG | Guidewire Global Solution Center - Build/Buy/Go & Ready for Go |

**Activity Type:**
| Index | Label | Description |
|-------|-------|-------------|
| 0 | Marketing | Joint marketing initiatives |
| 1 | Accelerator | Marketplace accelerator development/maintenance |
| 2 | Sponsorship/Events | Event sponsorship and attendance |
| 3 | Contracts | Legal and commercial agreements |
| 4 | Marketplace | Marketplace listing and compliance |
| 5 | Alliances | General alliance management activities |
| 6 | NPE | New Partner Enablement |
| 7 | Pipeline | Joint customer pipeline activities |
| 8 | Other | Miscellaneous |
| 9 | Guidewire PD | Product Development coordination |
| 10 | Training | Training and enablement |
| 11 | Campaign | Marketing campaigns |

### How Partner Boards Are Used

1. **Alliance managers** create tasks for both GW and partner team members
2. **Partners** access boards directly through Monday.com to update their own tasks
3. Tasks flow through groups: Pipeline -> Open Items -> Completed Items
4. The GAS application syncs all partner board data into a consolidated `MondayData` Google Sheet (206 rows currently) for cross-partner reporting and dashboard views
5. A `PartnerTranslate` sheet (106 mappings) normalizes partner name variations (e.g., "Verisk" -> "Insurance Services Office (ISO)", "DocuSign" -> "ABI Document Support Services(R) LLC") to match official Guidewire Marketplace names

---

## 3. Customer Pipeline Boards (8 Boards)

**Purpose:** Track joint customer engagement between Guidewire and a technology partner. These boards monitor which Guidewire customers are adopting or evaluating a partner's solution, including pipeline stage, product details, and system integrator involvement.

Currently 8 partners have dedicated customer boards:

| Partner | Board ID |
|---------|----------|
| OpenText | `18391300162` |
| Earnix | `18387689596` |
| Transcard | `18387724607` |
| Box | `18387787101` |
| Akur8 | `18387775916` |
| WTW | `18387720723` |
| Newgen | `18387657109` |
| Mitchell | `18387740672` |

### Template Schema (9 columns, consistent across all customer boards)

| Column | Column ID | Type | Purpose |
|--------|-----------|------|---------|
| Name | `name` | name | Customer/prospect company name |
| Subitems | `subtasks_mkpn13jd` | subtasks | Action items for this customer |
| Actions/Status | `long_text_mkpn4wpq` | long_text | Current status notes and next steps |
| Cust Status | `status` | status | Pipeline stage |
| Accelerator Used | `color_mkpn8zkz` | status | Whether GW marketplace accelerator is involved |
| GW Product | `dropdown_mkps4vc0` | dropdown | Which Guidewire product(s) the customer uses |
| Partner Product | `text_mkxxnbng` | text | Partner's product/solution being deployed |
| SI Involved | `dropdown_mkps1jsb` | dropdown | System integrator on the deal |
| Partner Name | `8856286808__text_mky8xe5` | text | Partner company name |

### Groups
- **Active Pipeline of GW Customers** - Prospects and in-progress opportunities
- **Current Customers** - Existing customers already using the partner solution

### Status Labels

**Customer Status (Pipeline Stages):**
| Index | Label | Description |
|-------|-------|-------------|
| 0 | Shortlisted | Customer has shortlisted the partner solution |
| 1 | Contracting | In contract negotiation |
| 2 | Early Contact | Initial outreach/discovery |
| 3 | Sold | Deal closed |
| 4 | Qualified Demo | Customer has seen a qualified demonstration |
| 5 | NA | Not applicable |
| 6 | Downselected | Customer chose a different solution |
| 7 | RFP Coming | Customer expected to issue RFP |
| 8 | Implementing | Currently in implementation |
| 9 | Implemented | Successfully deployed |
| 10 | Lost | Lost the opportunity |

**Accelerator Used:**
| Index | Label |
|-------|-------|
| 1 | Yes - Cloud |
| 2 | Yes - On Prem |
| 5 | No |

**GW Product (Guidewire Product Line):**
- PC SM (PolicyCenter Self-Managed)
- CC SM (ClaimCenter Self-Managed)
- BC SM (BillingCenter Self-Managed)
- PC Cloud, CC Cloud, BC Cloud (Cloud versions)
- iNow (InsuranceNow)
- CDA (Cloud Data & Analytics)
- Other

**SI Involved (System Integrators):**
Cap (Capgemini), EY, Cognizant, PWC, Deloitte, Accenture, Sollers, Infosys, Coforge

---

## 4. GW Internal Project Management Boards (4 Boards)

**Purpose:** Internal task management for the Guidewire Technology Alliances organization. These boards are used to assign and track work across four functional areas: Partner Management, Tech Ops, Marketing, and Marketplace. Unlike partner boards, these are Guidewire-internal only - partners do not have access.

### Board Registry

| Board | Board ID | Sheet Name | Purpose |
|-------|----------|------------|---------|
| Partner Management Activities | `9791255941` | GW_PartnerManagementActivities | Partner relationship management tasks |
| Tech Ops Activities | `9791272390` | GW_TechOpsActivities | Technical operations, accelerator builds, validation |
| Marketing Activities | `18374691224` | GW_MarketingActivities | Marketing project coordination |
| Marketplace Activities | `18375013360` | GW_IntegrationComplianceActivities | Marketplace listings, integration compliance |

### Template Schema (13 columns, identical across all 4 boards)

| Column | Column ID | Type | Purpose |
|--------|-----------|------|---------|
| Name | `name` | name | Task name |
| Subitems | `subtasks_mkp7am7a` | subtasks | Subtask breakdown |
| Comments/Notes | `status_1_mkn1ekgr` | long_text | Task notes and context |
| Activity Status | `color_mktakkpw` | status | Current state (same labels as partner boards) |
| Importance | `color_mkt9mypk` | status | Priority level (same labels as partner boards) |
| Activity Type | `color_mktqmpeh` | status | Functional category of work |
| Date Created | `date_1_mkn1x66b` | date | Task creation date |
| Date Due | `date_1_mkn1rbp8` | date | Target completion |
| Actual Completion | `dup__of_date_due_mkn1zx06` | date | When actually completed |
| Files | `files_mkn15ep0` | file | Attached documents |
| Tech Board Type | `9791140449__color_mktzarg2` | status | Which functional board the item belongs to |
| Owner | `9791140449__dropdown_mkxkq7zh` | dropdown | Person responsible |
| Assigned To | `9791140449__dropdown_mkxkgq8f` | dropdown | Person who assigned the task |

### Groups (consistent across all 4 boards)
- **Open Items** - Active work
- **Completed Items** - Finished tasks
- **Pipeline** - Planned future work

### Key Differences from Partner Boards

| Aspect | Partner Boards | GW Internal Boards |
|--------|---------------|-------------------|
| Access | Shared with partner | Guidewire-only |
| Owner field | Cross-org roles (dropdown) | Specific team members (19 people) |
| Activity types | Partner-focused (Accelerator, Contracts, NPE) | Function-focused (Marketplace, Validation, GSC RFG/BBG) |
| Board differentiation | One board per partner | One board per functional area |
| Tech Board Type column | Not present | Present - labels cross-board items |

### Activity Type Labels (GW Internal)
| Index | Label | Description |
|-------|-------|-------------|
| 0 | Marketplace | Marketplace listing and compliance tasks |
| 1 | Partner Management | Alliance relationship activities |
| 2 | TechAll Program | Technology Alliances program initiatives |
| 3 | Validation | Accelerator code validation for marketplace publishing |
| 4 | GSC RFG/BBG | Global Solution Center - Ready for Go / Build-Buy-Go engagements |
| 5 | TechAll Marketing | Tech Alliances marketing coordination |
| 6 | Referral | Partner referral tracking |
| 7 | Vanguards | Vanguards program activities |
| 8 | Other | Miscellaneous |

### Tech Board Type Labels
| Index | Label |
|-------|-------|
| 0 | Tech Ops Activities |
| 1 | Partner Management Activities |
| 2 | Marketing Activities |
| 3 | Marketplace Activities |

### Team Members (Owner/Assigned To - 19 people)
Aaron Shaw, Eric Apse, Fatima Aoulaghaed, Gregg Rabinold, Ian Doyle, Julie Higuchi, Kayla Page, Kelly Clayton, Ketaki Padhye, Lisa Vingerhoet, Melinda Earlywine, Paul Harper, Richard Pauly, Rod Gowan, Shannon Spies, Ted Ogrean, Tim Kennedy, Vivienne Hoary, Will Murphy

### Data Aggregation
All 4 GW boards are synced into a combined `GWMondayData` Google Sheet (currently 10 rows) for unified cross-functional reporting. Individual board data is also stored in dedicated sheets:
- `GW_PartnerManagementActivities` (8 rows)
- `GW_TechOpsActivities` (2 rows)
- `GW_MarketingActivities` (0 rows - newly created)
- `GW_IntegrationComplianceActivities` (2 rows)

---

## 5. Marketing Boards (3 Boards)

### 5a. Marketing Event Approval Requests (2025)

**Board ID:** `9710279044`
**Sheet:** MarketingApproval (55 rows)
**Purpose:** Multi-stage approval workflow for marketing events and activities requiring funding. Alliance managers submit requests that route through a chain of approvals.

#### Structure (21 columns)

| Column | Column ID | Type | Purpose |
|--------|-----------|------|---------|
| Name | `name` | name | Event/activity name |
| Subitems | `subitems` | subtasks | Related subtasks |
| Event URL | `text_mktj8ce4` | text | Link to event details |
| Priority | `color_mktjmqkc` | status | Priority 1, 2, or 3 |
| Funding Type | `color_mkxxef94` | status | How the event is funded |
| Overall Status | `status` | status | Approval pipeline stage |
| AllianceManager | `dropdown_mkx4e465` | dropdown | Requesting AM |
| Partner | `text_mkv092nh` | text | Partner involved |
| Requesting Department | `status_1` | status | Which team is requesting |
| Cost | `numeric_mktjxtjk` | numbers | Estimated cost |
| Date and Location | `text_mktkdwry` | text | Event logistics |
| Start Date | `date_mktkb5sf` | date | Event start date |
| Request Type | `status_16` | status | Type of marketing deliverable |
| Urgency | `color_mktjnf1b` | status | Normal or Rush |
| Number of Meetings or Receptions | `text_mktk5zwj` | text | Event scope |
| Total Audience | `text_mktkv2yd` | text | Expected reach |
| Expected Attendance | `text_mktk6sdh` | text | Headcount target |
| Speaking Opportunity | `long_text_mktkr2xz` | long_text | Speaker details |
| Justification Link | `link_mkv0qbf1` | link | Business justification document |
| Brand Details | `text_mktkfpbj` | text | Branding requirements |
| Create Date | `date_mktmw20b` | date | When request was submitted |

#### Groups (Approval Pipeline)
- **Incoming** - New submissions awaiting review
- **In Progress** - Under review/approval
- **Complete** - Fully approved
- **Rejected** - Denied requests

#### Funding Types
| Index | Label |
|-------|-------|
| 0 | Partner Funding Request |
| 1 | MDF (Market Development Funds) |
| 2 | Subsidized Event Request |

#### Request Types
Whitepaper or Customer Success, Videos/Vlogs, Other Collateral, Newsletter/Email Campaign, Sales Enablement Partner Pitch, Press Release, Social Promo, Blogs, GW.com or MP.com Promotional, Live Event

#### Requesting Departments
Product Marketing, GSC, Marketplace, Partner Management, Marketing, Product Development, CoSell

---

### 5b. 2026 Marketing Event Approval Requests

**Board ID:** `18389979949`
**Sheet:** Approvals2026 (2 rows, 72 columns)
**Purpose:** Significantly expanded version of the 2025 approval board. Introduces structured business case requirements, strategic fit assessment, activation planning, and post-event ROI reporting.

#### Major Expansion from 2025 (21 columns -> 65 columns)

The 2026 board represents a major evolution in the approval process, adding structured sections that mirror a multi-step submission form:

**Form Navigation Sections:**
1. Business Rationale
2. Business Outcome
3. Event Specific Information
4. Partner Information
5. Executive Summary
6. Resourcing Plan
7. Activation Plan
8. Reporting and ROI

#### New Column Categories in 2026

**Strategic Assessment (new):**
- Decision Date By
- Primary Objectives (MQL Generation, Pipeline Progression, Integration Awareness, Customer Story Capture, Competitive Positioning)
- Non-participation Risks
- Business Rationale (long text)
- Strategic Fit (Ecosystem leadership, High density target accounts, Integration launch, Customer Story Development, Competitive Differentiator)
- Market Position/Scale (Fuel, Strategic, High, Medium, Low)
- Integration Status (Cloud Native Coming Soon, Cloud Native Published, On Prem Only, None)

**Financial Detail (expanded):**
- Total Cost (formula - auto-calculated)
- Sponsor Costs
- Other Costs
- MDF Requested (Yes/No)
- AWS MDF Requested (Yes/No)

**Event Logistics (expanded):**
- Delivery Type (Partner Trade Show Co-Marketing, Partner Trade Show Sponsor Funding, Industry Trade Show, Guidewire Trade Show, Other)
- Estimated Attendees
- Named Customers/Prospects
- Target Personas (Underwriting, Digital CX, Data/AI, Other)
- Partner Recruitment Target
- Prospectus URL and File Upload
- Recommended Sponsor Tier

**Guidewire Events (new):**
- Guidewire Trade Show options: Connections, Executive Symposium, Marketplace Summit, Global Insurance Forum, Synergy, Partner Enablement Day, Tech Partner Advisory Council, Developer Summit, Developer Hackathon, 1:1 Breakfast/Lunch Meeting
- Industry Tradeshow options: Speaker Request, Cosponsor Request, Attendee Request
- 1:1 Description and Region (EMEA, APAC, LatAm, NAM)

**Resourcing (new):**
- Requestor
- Event Lead (AM)
- Onsite Team
- Speaker/Abstract/Session details
- Assets and Demo (Existing demo, Integration Video, Updated Slides)
- SWAG Type/quantity
- SME Speakers, Panel Content
- Partner Marketing Resources
- Product Marketing Resources

**Activation Planning (new):**
- Pre-event activation plan
- Onsite event activation plan
- Post-event activation plan

**ROI Reporting (new):**
- Post Event Report Due date
- New Leads
- Meetings Held
- Opportunities Created
- Pipeline $ Influenced
- Booth Scans
- Brand/Media Impressions
- Customer Feedback/Testimonials
- Competitive Insights
- Learnings for Next Year

#### Groups
- **Incoming** - New submissions
- **Complete** - Approved
- **Rejected** - Denied (Note: "In Progress" group removed vs. 2025)

---

### 5c. Marketing Event Calendar

**Board ID:** `9770467355`
**Sheet:** MarketingCalendar (72 rows)
**Purpose:** Tracks scheduled marketing events and activities throughout the year. Provides a calendar view of all marketing deliverables organized by month and week.

#### Structure (10 columns)

| Column | Column ID | Type | Purpose |
|--------|-----------|------|---------|
| Name | `name` | name | Event/deliverable name |
| Month | `color_mktk2s2a` | status | Calendar month (January-December) |
| Partner | `text_mkv0x0q8` | text | Associated partner |
| Owner | `color_mkv0q899` | status | Responsible team |
| Week | `color_mktkd041` | status | Week of month (1-5) |
| Activity Type | `color_mktk258r` | status | Type of marketing deliverable |
| Date | `formula_mktkr89x` | formula | Calculated date |
| Formula | `formula_mktkajwy` | formula | Supporting calculation |
| EventDate | `date_mktkyhta` | date | Actual event date |
| Submission link | `wf_edit_link_wxyrd` | link | Link to submission form |

#### Groups
- **Pending** - Upcoming scheduled events
- **Complete** - Past events

#### Owner Options
Alliance Manager, TechAlliance Ops, Marketplace, Marketing

#### Activity Types
Newsletters + Email Campaigns, Social Promo, Press Release, Live Event, Webinar, Blogs, Whitepaper or Customer Success, Videos/Vlogs, GW.com or MP.com Promo, GW Events/MP Summit, Sales Enablement Pitch Packages, Other

---

## Data Integration Architecture

### Google Sheets Data Store

The GAS application maintains 20 sheets that store synced Monday.com data and application configuration:

| Sheet | Rows | Purpose |
|-------|------|---------|
| Config | 23 | Application configuration |
| MondayData | 206 | Aggregated data from all 43 partner activity boards |
| GWMondayData | 10 | Aggregated data from all 4 GW internal boards |
| GW_PartnerManagementActivities | 8 | GW Board 1 raw data |
| GW_TechOpsActivities | 2 | GW Board 2 raw data |
| GW_MarketingActivities | 0 | GW Board 3 raw data (newly created) |
| GW_IntegrationComplianceActivities | 2 | GW Board 4 raw data |
| GW_MarketplaceActivities | 2 | Additional marketplace data |
| MarketingApproval | 55 | Marketing approval request data |
| MarketingCalendar | 72 | Marketing calendar events |
| MarketingCalendarStats | 10 | Calendar analytics/summaries |
| Approvals2026 | 2 | 2026 approval requests |
| 2026Flow | 62 | 2026 approval workflow configuration |
| MondayDashboard | 44 | Partner dashboard data (master registry) |
| AllianceManager | 38 | Alliance manager roster |
| TechAllianceManager | 24 | Extended team configuration |
| InternalBoards | 5 | GW board configuration |
| PartnerTranslate | 107 | Partner name normalization mappings |
| Partner | 995 | Partner master data (from Guidewire Marketplace) |
| PartnerContacts | 339 | Partner contact information |

### Sync Flow

```
Monday.com Boards  ──── GraphQL API v2 ────>  Google Apps Script
                                                     │
                                    ┌────────────────┼────────────────┐
                                    │                │                │
                              Partner Boards    GW Boards     Marketing Boards
                                    │                │                │
                                    ▼                ▼                ▼
                              MondayData      GWMondayData    MarketingApproval
                              (aggregated)    (aggregated)    MarketingCalendar
                                                              Approvals2026
                                    │                │                │
                                    └────────────────┼────────────────┘
                                                     │
                                                     ▼
                                          Alliance Manager Portal
                                          (React Web Application)
```

### Partner Name Translation

The `PartnerTranslate` sheet (106 mappings) normalizes informal or abbreviated partner names used on Monday.com boards to official Guidewire Marketplace partner names. Examples:
- "Verisk" -> "Insurance Services Office (ISO)"
- "DocuSign" -> "ABI Document Support Services(R) LLC"
- "IVANS" -> "Applied Systems Inc"
- "Blue Prism" -> "SS&C Blue Prism"
- "Indico" -> "Indico Data Solutions, Inc"

---

## Board Relationships & Workflow

### Partner Lifecycle Flow

```
1. New Partner Onboarded
   └─> Entry created on Primary Partner Board (Status: "Onboarded")
   └─> Dedicated Partner Activity Board created from template
   └─> (Optional) Customer Pipeline Board created if active pipeline exists

2. Partner Activated
   └─> Status updated to "Activated" on Primary Partner Board
   └─> Alliance Manager begins creating tasks on Partner Activity Board
   └─> Partner team members access their board directly on Monday.com

3. Ongoing Operations
   └─> Tasks created on Partner Activity Board (Open Items group)
   └─> Internal tasks created on GW Internal Boards
   └─> Marketing events submitted through Approval workflow
   └─> Customer pipeline tracked on Customer Board

4. Reporting
   └─> GAS application syncs all boards to Google Sheets
   └─> Alliance Manager Portal provides dashboards and views
   └─> Data aggregated for cross-partner reporting
```

### Marketing Approval Workflow (2026)

```
AM Submits Request ──> Incoming Group
        │
        ▼
  Business Case Review
  (Rationale, Strategic Fit, Cost)
        │
        ▼
  Approval Chain
  (Department Head → Sr. Director → Marketing)
        │
   ┌────┴────┐
   ▼         ▼
Complete   Rejected
   │
   ▼
Event Execution
   │
   ▼
Post-Event ROI Report
(Leads, Meetings, Pipeline, Impressions)
```

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total Monday.com Boards | 56+ |
| Partner Activity Boards | 43 |
| Customer Pipeline Boards | 8 |
| GW Internal Boards | 4 |
| Marketing Boards | 3 |
| Dashboard Board | 1 |
| Active Partners | 43 |
| Alliance Managers | 11 |
| Full Team Members | 19 |
| Partner Name Translations | 106 |
| Google Sheets | 20 |
| Total Synced Rows | ~1,400+ |

---

*Generated from live Monday.com board structure audit - February 2026*
