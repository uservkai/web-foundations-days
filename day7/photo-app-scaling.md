# SnapShare - Scaling Plan

## Assumptions

- 10,000,000 registered users; 10% are active each day.
- Each active user uploads 1 photo and views 50 feed pages per day.
- Photo: 2 MB. Thumbnail: 50 KB. Peak traffic = 5x the average.
- 1 day is rounded to about 100,000 seconds (exactly 86,400) to keep the maths simple.
- **Daily active users (DAU)** = 10,000,000 x 10% = **1,000,000**.

## Estimates

- **Uploads:** 1,000,000 per day / 100,000 = **about 10 per second** (peak about 50/s).
- **Feed views:** 1,000,000 x 50 = 50,000,000 per day / 100,000 = **about 500 per second** (peak about 2,500/s).
- **Storage:** 1,000,000 x (2 MB + 0.05 MB) = about 2 TB per day, so **about 750 TB per year**.

## Read-heavy or write-heavy?

**Read-heavy:** there are about 50 feed views for every upload. So we make reads cheap
(CDN for images, cache for feeds, read replicas for queries) and keep uploads reliable
rather than instant. One primary database can handle the small write load.

## Where do the photos go?

Photos must NOT be stored in the database. 750 TB per year of large binary files would make
the database huge, slow, expensive to back up and replicate, and serving images would tie up
database connections. Photo files go into **object storage** (such as Amazon S3), which is
built for cheap, durable storage of large files. The database stores only each photo's
metadata: id, owner, caption, time and the file's URL.

## Architecture

```
  Mobile app / browser
     |
     |-- photo & thumbnail downloads --> CDN --(cache miss)--> Object storage
     |                                                          ^        ^
     |-- API calls (HTTPS) --> Load balancer                    |        |
                                   |                            |        |
                    +--------------+--------------+             |        |
                    |              |              |             |        |
               App server 1   App server 2   App server 3 ------+        |
                    |              |              |   (save original)    |
                    +--------------+--------------+                      |
                         |         |         |                            |
                         |         |         +--> Queue --> Thumbnail ----+
                         |         |            (jobs)      worker (save thumbnail)
                         |         |
                         |         +--> Cache (Redis): prepared feeds
                         v
                    Primary DB ---- replicates ----> Read replica(s)
                    (metadata, writes)               (feed queries, reads)
```

## Components (one sentence each)

- **CDN:** serves photos and thumbnails from servers close to users, so images load fast and our servers are not overloaded by about 2,500 feed views per second at peak.
- **Load balancer:** spreads incoming API requests across the app servers and stops sending traffic to any server that fails.
- **App servers (stateless):** run the API logic (login checks, uploads, feeds) and can be scaled out by simply adding more of them.
- **Cache (Redis):** keeps each user's prepared feed in fast memory so repeated scrolling does not hit the database.
- **Primary database:** the single source of truth for users, follows and photo metadata, and the only place writes go.
- **Read replica:** holds a live copy of the primary and answers the heavy feed read queries, protecting the primary and letting reads scale.
- **Object storage:** the cheap, durable home for hundreds of terabytes of photo and thumbnail files that a database could not handle.
- **Queue:** holds "make thumbnail" jobs so the upload request can finish without waiting for image processing, and keeps jobs safe if workers are busy or down.
- **Thumbnail worker:** takes jobs from the queue, creates the 50 KB thumbnail in the background and saves it, and can be scaled separately from the app servers.

## Upload flow

1. The app sends the photo to an app server through the load balancer.
2. The app server checks the user's token, and the file type and size.
3. It saves the original 2 MB file to object storage.
4. It inserts a row with the photo's metadata into the primary database (status: "processing").
5. It adds a job "make thumbnail for photo 123" to the queue.
6. It replies 201 Created to the user straight away.
7. A thumbnail worker takes the job, reads the original from object storage, creates the 50 KB thumbnail, saves it to object storage and updates the photo's row with the thumbnail URL (status: "ready").
8. If the worker fails, the job returns to the queue and is retried, so no photo is left without a thumbnail.
9. The followers' cached feeds are invalidated or refreshed so the new photo appears.
10. Followers then load the thumbnail through the CDN, which fetches it from object storage on a cache miss.

## Trade-offs

1. **Speed vs freshness (cache):** feeds come from the cache, so a new photo may take a few seconds to appear for followers. This is acceptable for a social app and greatly reduces database load.
2. **Fast uploads vs instant thumbnails (queue):** thumbnails are made in the background, so for a moment a photo has no thumbnail and the app shows a placeholder. In return, uploads stay fast even at peak, and we must run and monitor a queue and workers.
3. **Read scaling vs consistency (read replica):** replicas can lag slightly behind the primary, so a user might not see their own new photo immediately. We can read a user's own recent uploads from the primary to fix this, at the cost of extra complexity.
4. **Cost:** the CDN and object storage cost money per gigabyte, but they are far cheaper and more reliable than storing and serving hundreds of terabytes from our own servers.
