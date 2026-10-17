# TicketHub: System Design

TicketHub is a website that sells tickets for concerts and events. This document follows the six-part framework: requirements, estimates, API, data model, architecture, and trade-offs.

**Given facts:** 2 million registered users. On a normal day, 50,000 people visit and each views 10 pages, and 5,000 tickets are sold. When a popular concert goes on sale, 200,000 people try to buy its 20,000 seats within the first 10 minutes.

---

## 1. Requirements

### Functional

1. Users can register, log in and log out.
2. Users can browse and search events by name, date, city and category.
3. Users can view an event's details and its seat map with the live status of each seat (available, held, sold).
4. Users can **hold** one to four seats for a short time (5 minutes) while they pay.
5. Users can pay for held seats and receive confirmed tickets.
6. Users can see their tickets and past orders, and receive a confirmation email.
7. Held seats that are not paid for are released automatically when the hold expires.
8. Admins can create events and define their seats and prices.

### Non-functional

| Quality | Requirement |
| --- | --- |
| **Speed** | Browsing pages respond in under 300 ms (p95). Seat map loads in under 500 ms. Holding seats responds in under 500 ms, even during a big sale. |
| **Correctness** | A seat is **never** sold to two people. A user is never charged without receiving tickets (or being refunded). Retrying a payment never charges twice. |
| **Fairness** | During a big sale, users get a fair chance: a waiting room admits people in an orderly way, each user is limited to a few seats, and bots are slowed down. |
| **Availability** | 99.9% uptime overall. The site must degrade gracefully (a slower queue) rather than crash during a big sale. |
| **Durability** | Once an order is confirmed, it is never lost (database replication and backups). |
| **Security** | Passwords hashed, HTTPS everywhere, card details handled only by the payment provider, users can only see their own tickets. |
| **Scalability** | Able to handle roughly 500 times the normal request rate for short bursts. |

---

## 2. Estimates

### Normal day

- Page views: 50,000 visitors × 10 pages = **500,000 page views/day**.
- Average rate: 500,000 / 86,400 s ≈ **6 requests/second**.
- Traffic is not even across the day. Assuming the busiest hour has about 10× the average: **~60 requests/second at peak**.
- Sales: 5,000 tickets/day ≈ 0.06 tickets/second on average (about 1/second in a busy hour).
- Storage: about 5,000 tickets/day × 365 ≈ 1.8 million tickets/year. At roughly 1 KB per row (ticket plus order data), that is about **2 GB/year**, which is small.

### Big sale (one popular concert)

- 200,000 users arrive in 10 minutes (600 seconds) ≈ **333 new users/second**.
- Each user makes about 10 requests in that window (loading the event page, checking the seat map several times, trying to hold, paying). That is 2,000,000 requests / 600 s ≈ **3,300 requests/second on average**. Traffic arrives in a spike at the start, so assume **2× for the first minute: ~6,500 requests/second**.
- Seat-hold attempts: assume each user tries about 3 times (seats get taken) = 600,000 attempts / 600 s ≈ **1,000 write attempts/second**.
- Tickets actually sold: 20,000 / 600 s ≈ **33 tickets/second**.
- Contention: 200,000 users for 20,000 seats means **10 people per seat**. Popular seats will be fought over by many people at the same moment.

### Comparison

| Metric | Normal day (average) | Big sale (average over 10 min) | Ratio |
| --- | --- | --- | --- |
| Requests/second | ~6 | ~3,300 | **~550×** |
| Tickets sold/second | ~0.06 | ~33 | **~550×** |
| People wanting the same item | rarely | 10 per seat | n/a |

In 10 minutes, the big sale sells 20,000 tickets, which is **4× the number of tickets sold on a whole normal day**. A system sized for normal days would fail, but we should not size the entire system for the peak all the time. Instead we **absorb the peak** with caching, a waiting room, and a database design that stays correct under contention (sections 5 and 6).

---

## 3. API

All endpoints use HTTPS and JSON. Endpoints marked 🔒 require a login token.

| # | Method & path | Purpose |
| --- | --- | --- |
| 1 | `GET /events?query=&city=&date=&page=` | Browse and search events (paginated). |
| 2 | `GET /events/{event_id}` | Event details (name, venue, date, price range). |
| 3 | `GET /events/{event_id}/seats?section=` | View seats and their status. |
| 4 | 🔒 `POST /events/{event_id}/queue` | Join the waiting room for a big sale; returns a queue token. `GET /events/{event_id}/queue/status` shows position. |
| 5 | 🔒 `POST /events/{event_id}/holds` | Hold seats. |
| 6 | 🔒 `DELETE /holds/{hold_id}` | Release a hold early. |
| 7 | 🔒 `POST /orders` | Create an order from a hold. |
| 8 | 🔒 `POST /orders/{order_id}/payment` | Pay for an order. |
| 9 | 🔒 `GET /me/tickets` | View my tickets. |
| 10 | `POST /payments/webhook` | Payment provider confirms the result (signature checked). |
| 11 | `POST /auth/register`, `POST /auth/login` | Create account and log in. |

### Key examples

**Hold seats**

```http
POST /events/42/holds
Authorization: Bearer <token>

{ "seat_ids": [1001, 1002] }
```

Success `201 Created`:

```json
{ "hold_id": 7781, "seat_ids": [1001, 1002], "expires_at": "2026-11-01T19:05:00Z" }
```

Failure `409 Conflict` (someone else got a seat first, **no seats are held**):

```json
{ "error": "SEAT_UNAVAILABLE", "unavailable_seat_ids": [1002] }
```

Other errors: `429 Too Many Requests` (rate limit), `403` (not admitted from the waiting room), `422` (more than 4 seats).

**Create order and pay**

```http
POST /orders
Idempotency-Key: 9f1c...      (a unique value generated by the client)
{ "hold_id": 7781 }
```

```http
POST /orders/555/payment
Idempotency-Key: 4b7a...
{ "payment_token": "tok_abc123" }
```

The `Idempotency-Key` header means that if the user's network drops and the request is retried, the server returns the first result instead of creating a second order or charge.

**View my tickets**

```http
GET /me/tickets
```

```json
[{ "ticket_id": 9001, "event": "Rock Night", "section": "A", "row": "3", "seat": "12", "order_id": 555 }]
```

---

## 4. Data Model

Relational database (PostgreSQL). We choose a relational database because seat ownership needs strong transactions and constraints.

```
users 1 ───< orders 1 ───< tickets >─── 1 seats >─── 1 events
  │                              ▲            │
  └───< holds 1 ───< seats ──────┘ (seats.hold_id)
```

In words: a user has many orders and many holds. An event has many seats. An order has many tickets. Each ticket refers to exactly one seat. A hold covers many seats.

### `users`

| Column | Type | Notes |
| --- | --- | --- |
| id | BIGINT PK | |
| email | TEXT NOT NULL **UNIQUE** | |
| password_hash | TEXT NOT NULL | never store plain passwords |
| name | TEXT | |
| created_at | TIMESTAMPTZ | |

### `events`

| Column | Type | Notes |
| --- | --- | --- |
| id | BIGINT PK | |
| name | TEXT NOT NULL | |
| venue, city | TEXT | index on (city, starts_at) |
| starts_at | TIMESTAMPTZ NOT NULL | |
| on_sale_at | TIMESTAMPTZ | when tickets become available |
| total_seats | INT | |

### `seats`

| Column | Type | Notes |
| --- | --- | --- |
| id | BIGINT PK | |
| event_id | BIGINT FK → events.id | |
| section, row_label, seat_number | TEXT | |
| price_cents | INT NOT NULL | |
| status | TEXT NOT NULL | `available`, `held`, `sold`; CHECK constraint |
| hold_id | BIGINT FK → holds.id, NULL | set when held |
| hold_expires_at | TIMESTAMPTZ, NULL | |
| | | **UNIQUE (event_id, section, row_label, seat_number)** so a physical seat exists only once per event |
| | | Index on (event_id, status) for the seat map |

### `holds`

| Column | Type | Notes |
| --- | --- | --- |
| id | BIGINT PK | |
| user_id | BIGINT FK → users.id | |
| event_id | BIGINT FK → events.id | |
| expires_at | TIMESTAMPTZ NOT NULL | now + 5 minutes |
| status | TEXT | `active`, `converted`, `released`, `expired` |

### `orders`

| Column | Type | Notes |
| --- | --- | --- |
| id | BIGINT PK | |
| user_id | BIGINT FK → users.id | |
| hold_id | BIGINT FK → holds.id **UNIQUE** | a hold becomes at most one order |
| status | TEXT | `pending_payment`, `paid`, `failed`, `refunded` |
| total_cents | INT | |
| idempotency_key | TEXT **UNIQUE** | prevents duplicate orders on retry |
| payment_ref | TEXT | provider's payment id |
| created_at | TIMESTAMPTZ | |

### `tickets`

| Column | Type | Notes |
| --- | --- | --- |
| id | BIGINT PK | |
| order_id | BIGINT FK → orders.id | |
| seat_id | BIGINT FK → seats.id **UNIQUE** | **the final safety net: one ticket per seat, ever** |
| user_id | BIGINT FK → users.id | |
| issued_at | TIMESTAMPTZ | |

---

## 5. How the design prevents two people buying the same seat

Double-booking happens when two requests both read "this seat is available" and both then write "this seat is mine". We prevent it with three layers, so even if one has a bug, the next catches it.

### Layer 1: Atomic conditional update (the hold)

Holding a seat is **one SQL statement** that checks and changes the status together, so there is no gap between "check" and "write":

```sql
BEGIN;
UPDATE seats
SET    status = 'held', hold_id = :hold_id, hold_expires_at = now() + interval '5 minutes'
WHERE  id = :seat_id
  AND (status = 'available'
       OR (status = 'held' AND hold_expires_at < now()));   -- expired holds can be taken
-- the application checks: rows affected = 1 ?
COMMIT;
```

If two users run this at the same moment, the database takes a **row lock** on the seat for the first one. The second waits, then re-evaluates the `WHERE` clause on the updated row. It now sees `status = 'held'` and not expired, so it updates **0 rows**. The app sees 0 rows affected and returns `409 SEAT_UNAVAILABLE`. Exactly one user wins.

When a user holds several seats, all the updates run in **one transaction**, ordered by seat id (to avoid deadlocks between two users locking seats in opposite order). If any seat returns 0 rows, the transaction is **rolled back**, so the user holds all of the seats or none of them.

### Layer 2: Transaction at purchase time

When payment succeeds, we finalize in one transaction:

```sql
BEGIN;
SELECT id FROM seats WHERE hold_id = :hold_id AND status = 'held'
  AND hold_expires_at > now() FOR UPDATE;       -- lock and verify I still own them
-- if the count differs from the number of seats in the order, ROLLBACK and refund
INSERT INTO tickets (order_id, seat_id, user_id) ...;
UPDATE seats SET status = 'sold' WHERE hold_id = :hold_id;
UPDATE orders SET status = 'paid' WHERE id = :order_id;
COMMIT;
```

Either all of this happens or none of it (atomicity). Nobody else can change these seats in the middle because of the `FOR UPDATE` lock.

We never keep a database transaction open while waiting for the payment provider, because a slow payment would hold locks and block everyone else. The **hold** is what reserves the seat during payment. When payment starts, the hold is extended slightly (for example, by 2 more minutes) so it does not expire mid-payment. If payment succeeds but the hold somehow expired and another user took the seat, the transaction in this layer fails and we automatically refund the user.

### Layer 3: Database constraint (the safety net)

`tickets.seat_id` is **UNIQUE**. Even if there were a bug in the application code, the database would physically refuse to insert a second ticket for the same seat, and the transaction would fail. Constraints are enforced by the database for every client, so they cannot be bypassed by a coding mistake.

### Supporting measures

- **Expiry:** a background worker releases expired holds every few seconds (`status = 'available'`). Correctness does not depend on it, since the hold query above already treats expired holds as available. It only keeps the seat map accurate.
- **Idempotency:** the `UNIQUE` idempotency key on orders and `UNIQUE hold_id` mean that double-clicks and retries cannot create two orders or two charges.
- **Single source of truth:** only the primary database decides seat ownership. Caches and replicas are only used for *displaying* the seat map, never for deciding who gets a seat.

---

## 6. Architecture

```
                         Users (browser / mobile)
                                   │
                          ┌────────▼────────┐
                          │       CDN       │  static files, event images,
                          └────────┬────────┘  cached event pages
                                   │
                          ┌────────▼────────┐
                          │  Load balancer  │  + rate limiting, bot checks
                          └────────┬────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ Waiting room service        │──────┐
                    │ (admits users in batches)   │      │
                    └──────────────┬──────────────┘      │
                                   │ admitted users      │
                    ┌──────────────▼──────────────┐      │
                    │  API servers (stateless,    │      │
                    │  many copies, auto-scaled)  │      │
                    └───┬──────────┬───────────┬──┘      │
                        │          │           │         │
            ┌───────────▼──┐  ┌────▼────────┐  │   ┌─────▼──────┐
            │ Redis cache  │  │ PostgreSQL  │  │   │   Redis    │
            │ seat maps,   │  │  PRIMARY    │  │   │ queue state│
            │ event data   │  │ (all writes)│  │   └────────────┘
            └──────────────┘  └────┬────────┘  │
                                   │ replication│
                              ┌────▼────────┐   │
                              │ Read replicas│   │
                              │ (browsing)   │   │
                              └─────────────┘   │
                                                │
                    ┌───────────────────────────▼──┐        ┌──────────────────┐
                    │ Message queue + workers      │───────▶│ Email service    │
                    │ (expire holds, send emails)  │        └──────────────────┘
                    └──────────────────────────────┘
                    API servers ◀──── webhook ────▶ Payment provider
```

### Components

| Component | What it does and why |
| --- | --- |
| **CDN** | Serves images, scripts and even event pages from locations close to users. Takes most of the browsing load off our servers, which matters because browsing is the bulk of the 3,300 requests/second. |
| **Load balancer** | Spreads requests across API servers, removes unhealthy ones, and enforces per-user and per-IP rate limits (and CAPTCHA for suspicious clients) for fairness against bots. |
| **Waiting room service** | During a big sale, users are placed in a queue (position decided by arrival time, with a short randomized window so that being a millisecond faster does not matter). Only a fixed number per minute are admitted to the buying flow. This converts a spike of 200,000 users into a steady stream the database can handle, and it is the main fairness mechanism. Queue state is kept in Redis. |
| **API servers** | Stateless application servers that implement the endpoints in section 3. Because they keep no state, we can add copies quickly when a big sale is announced (we know sale times in advance, so we can scale up beforehand). |
| **Redis cache** | Stores event details and the seat map for 1 to 2 seconds. Thousands of users viewing the seat map hit the cache rather than the database. A slightly stale map is acceptable (see trade-offs), because the hold step is always checked against the database. |
| **PostgreSQL primary** | The single source of truth for seats, holds, orders and tickets. All writes and all seat-ownership decisions happen here, which is what makes the double-booking protection in section 5 work. |
| **Read replicas** | Copies of the database used for browsing and search queries, so reads never compete with the hold and purchase transactions. |
| **Message queue + workers** | Handle slow, non-urgent work off the main path: releasing expired holds, sending confirmation emails, and retrying failed jobs. The buyer does not wait for the email. |
| **Payment provider** | External service that handles card details. It notifies us through a signed webhook, and we also accept the synchronous result. This keeps card data away from our servers. |

### How it survives the big sale

1. **Most requests never reach the database.** The CDN and Redis serve static and cached content, so the roughly 3,300 requests/second are mostly absorbed before the primary database.
2. **The waiting room limits the write load.** Only admitted users can attempt holds, so the primary database receives a controlled, steady flow of hold and purchase transactions instead of 1,000+ attempts/second at once. The sale still completes quickly: 33 sales/second is trivial for one well-indexed PostgreSQL primary, and the data is small (20,000 seat rows for the event).
3. **Seat contention is cheap.** Each hold is a short, single-row-lock transaction. Losers get a fast `409` and choose another seat.
4. **We scale in advance.** Sale times are known, so we add API servers and warm the cache before the sale starts.
5. **Failures degrade gracefully.** If the system is overloaded, the waiting room slows admissions down instead of the site failing. If an API server dies, the load balancer routes around it. If the primary fails, a replica is promoted. Orders already confirmed are durable because they are replicated before being acknowledged.
6. **One event does not hurt the others.** Browsing other events uses replicas and cache, so a big sale does not take down the rest of the site.

---

## 7. Trade-offs

### Trade-off 1: One primary database (strong consistency) vs. a sharded or distributed design

- **Choice:** All seat ownership decisions go through a single PostgreSQL primary.
- **Benefit:** Transactions, row locks and unique constraints give simple, provably correct protection against double-booking. A distributed solution (for example, locks across several nodes, or sharding seats across databases) is harder to reason about and easier to get subtly wrong.
- **Cost:** The primary is a write bottleneck and a single point of failure. We accept this because our measured peak (about 1,000 write attempts/second, 33 sales/second) is well within one database's capacity, and the waiting room caps the load further. We reduce the failure risk with a replica ready for promotion. If TicketHub grew to many simultaneous big sales, we could shard by `event_id`, since events do not share seats.

### Trade-off 2: Cached (slightly stale) seat map vs. a perfectly live one

- **Choice:** The seat map is cached for 1 to 2 seconds.
- **Benefit:** Protects the database from thousands of users refreshing the seat map.
- **Cost:** A user may click a seat that was just taken and get "seat unavailable". This is an annoyance, but never a correctness problem, because the hold is verified against the primary database. We decided that a small amount of staleness is a better trade than slow pages or a database that falls over.

### Trade-off 3: Waiting room (fairness and protection) vs. simplicity and speed for the user

- **Choice:** A queue admits users in controlled batches during big sales.
- **Benefit:** Protects the system and gives everyone an orderly, fair chance. It also discourages bots, since being fast stops mattering.
- **Cost:** More complexity to build, and users may wait several minutes to even see the seat map, even if there would have been capacity for some of them. For normal events with low demand, the waiting room is switched off.

### Trade-off 4: Hold duration (5 minutes)

- **Short holds** free seats quickly for other buyers, but a user on a slow payment may lose their seats.
- **Long holds** give users comfort, but bots or indecisive users can lock up seats and make the event look sold out when it is not.
- We chose 5 minutes, extended slightly once payment has actually started, as a balance.
