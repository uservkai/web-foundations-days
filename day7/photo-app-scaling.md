# SnapShare: Scaling Plan

SnapShare is a photo-sharing app. Users upload photos and scroll a feed of photos from people they follow.

## 1. Assumptions

- Registered users: 10,000,000
- Daily active users (DAU): 10% of registered users
- Each active user uploads 1 photo per day
- Each active user views 50 feed pages per day
- Average photo: 2 MB. Each photo also gets one 50 KB thumbnail.
- Traffic is spread over 24 hours (86,400 seconds) on average. Peak traffic is 5x the average.
- Storage uses decimal units (1 TB = 1,000,000 MB). Replication and backups are ignored for now.

**Daily active users** = 10,000,000 x 10% = **1,000,000 DAU**

## 2. Estimates

### Uploads per second

- Uploads per day = 1,000,000 x 1 = 1,000,000
- Average = 1,000,000 / 86,400 = **about 11.6 uploads/s**
- Peak (5x) = **about 58 uploads/s**

### Feed views per second

- Feed views per day = 1,000,000 x 50 = 50,000,000
- Average = 50,000,000 / 86,400 = **about 579 views/s**
- Peak (5x) = **about 2,900 views/s**

### Photo storage per year

- Per photo = 2 MB original + 0.05 MB thumbnail = 2.05 MB
- Per day = 1,000,000 x 2.05 MB = 2,050,000 MB = **2.05 TB/day**
- Per year = 2.05 TB x 365 = **about 748 TB/year (roughly 0.75 PB)**
  - Originals: 730 TB. Thumbnails: 18.25 TB.

| Metric | Average | Peak (5x) |
| --- | --- | --- |
| Uploads/s | 11.6 | 58 |
| Feed views/s | 579 | 2,900 |
| Storage/year | 748 TB | n/a |

## 3. Read-heavy or write-heavy?

**SnapShare is read-heavy.** There are 50 feed views for every 1 upload, a 50:1 read-to-write ratio. Each feed view also loads many thumbnails, so the real file-read load is even higher.

What this means for the design:

- Make reads cheap and fast: cache feeds and hot data, and serve images from a CDN.
- Scale reads with a database read replica (and more replicas later).
- Writes (about 58/s at peak) are modest, so one primary database can handle them for a long time.
- Slow work on the write path, such as thumbnail creation, goes to a queue so uploads stay fast.

## 4. Why photos must not be stored in the database

- **Size:** At 2 MB each, photos add about 730 TB per year. That would bloat the database, slow queries and backups, and make replication very expensive.
- **Cost:** Database storage is far more expensive per GB than object storage.
- **Wrong tool:** Databases are built for small structured rows (user IDs, captions, follower lists), not large binary files.
- **Delivery:** Photos served through the database tie up database connections. Object storage plus a CDN can serve them directly, close to the user.

**Where they go instead:** Photo files (originals and thumbnails) go into **object storage** (such as Amazon S3). The database stores only metadata, including the photo's URL or key in object storage, the owner, the caption and the timestamp.

## 5. Architecture diagram

```
                           +----------+
                           |  Users   |
                           | (app/web)|
                           +----+-----+
                                |
              photo/thumbnail   |   API requests
              downloads         |   (feed, upload)
          +---------------------+----------------------+
          |                                            |
          v                                            v
   +-------------+                            +----------------+
   |     CDN     |                            | Load Balancer  |
   | (edge cache)|                            +-------+--------+
   +------+------+                                    |
          | cache miss                 +--------------+--------------+
          v                            v              v              v
   +--------------+              +----------+   +----------+   +----------+
   |   Object     |              | App      |   | App      |   | App      |
   |   Storage    |<-------------| Server 1 |   | Server 2 |   | Server N |
   | (originals + |  upload      +----+-----+   +----+-----+   +----+-----+
   |  thumbnails) |  original         |              |              |
   +------^-------+                   +------+-------+--------------+
          |                                  |
          | write thumbnail                  +----------------+
          |                                  |                |
   +------+-------+                          v                v
   |   Worker(s)  |                   +-----------+   +---------------+
   |  (thumbnail) |                   |   Cache   |   |   Database    |
   +------^-------+                   |  (Redis)  |   |   (primary)   |
          | takes jobs                +-----------+   +-------+-------+
   +------+-------+                                           | replication
   |    Queue     |<------- "create thumbnail" job -----------+   |
   +--------------+         (sent by app server)                  v
                                                          +---------------+
                                                          | Read Replica  |
                                                          +---------------+

 Reads of feed: App server -> Cache -> (miss) -> Read Replica
 Writes (new photo row): App server -> Primary DB
```

## 6. Components: one sentence each

- **CDN:** Serves photos and thumbnails from servers near the user, which cuts latency and takes most image traffic off our own servers.
- **Load balancer:** Spreads incoming requests across many app servers so no single server is overloaded and one failure doesn't take the app down.
- **App servers:** Run the application logic (authentication, feed building, upload handling) and can be scaled out by adding more identical servers.
- **Cache:** Keeps frequently read data (such as feeds and user profiles) in fast memory so repeated reads don't hit the database.
- **Database (primary):** Stores the structured metadata (users, follows, photo records) reliably and takes all the writes.
- **Read replica:** Holds a copy of the primary and answers read queries, which spreads out our read-heavy load and protects the primary.
- **Object storage:** Stores the large photo and thumbnail files cheaply and durably at petabyte scale, which a database cannot do well.
- **Queue:** Holds "create thumbnail" jobs so the upload request can finish immediately without waiting for image processing.
- **Worker:** Picks jobs off the queue, creates the 50 KB thumbnail, and saves it, so heavy image processing runs outside the user's request and can be scaled separately.

## 7. Upload flow, step by step

1. The user picks a photo in the app and taps upload.
2. The request goes through the **load balancer** to one of the **app servers**.
3. The app server checks the user is logged in and validates the file (type and size limit).
4. The app server saves the original 2 MB file to **object storage** and receives its storage key/URL.
5. The app server writes a metadata row (photo ID, user ID, caption, key, timestamp, status "processing") to the **primary database**.
6. The app server puts a "create thumbnail" job (containing the photo ID and key) on the **queue**.
7. The app server immediately replies "upload successful" to the user, without waiting for the thumbnail.
8. A **worker** takes the job from the queue, downloads the original from object storage, and generates a 50 KB thumbnail.
9. The worker saves the thumbnail to object storage and updates the database row (thumbnail key, status "ready").
10. The worker's update also lets the app server invalidate or refresh the cached feeds for the uploader's followers.
11. When followers load their feed, the app reads the metadata (cache, then read replica) and the app downloads thumbnails through the **CDN**, which fetches from object storage on a cache miss.

If a worker fails, the job stays in (or returns to) the queue and is retried, so no photo is left without a thumbnail.

## 8. Trade-offs

1. **Caching speeds reads but can show stale data.** A cached feed might not show a brand-new photo for a few seconds or minutes. We accept this because a slightly old feed is fine for a photo app, and the cache greatly reduces database load. A shorter cache time means fresher data but more database traffic.
2. **Read replicas add scale but have replication lag.** Replicas can briefly be behind the primary, so a user might upload a photo and not see it in their own feed immediately. A fix is to read the user's own recent uploads from the primary, at the cost of extra complexity.
3. **A queue makes uploads fast but makes thumbnails asynchronous.** The upload returns quickly, but the thumbnail appears a moment later, so the app needs a "processing" state or a temporary placeholder. This also adds another system (queue and workers) to run and monitor.
4. **A CDN reduces latency and load but costs money and complicates updates.** Delivering about 748 TB of new images per year through a CDN is not free, and deleted or changed photos may remain cached at the edge until they expire or are purged.
