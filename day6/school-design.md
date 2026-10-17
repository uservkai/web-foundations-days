# School Database Design

## Tables

**students** – one row per person who studies at the school. It stores a unique `id` (primary key), the student's `name` and their `email`. The email is `NOT NULL` and `UNIQUE`, so two students cannot share an address and every student can be contacted.

**courses** – one row per course on offer. It stores a unique `id` (primary key), the course `title` and the number of `credits`. Courses exist independently of students, so a new course can be added before anyone has enrolled.

**enrolments** – one row per "this student is enrolled on this course". It holds `student_id` and `course_id` (both foreign keys, both `NOT NULL`), the `grade` (nullable, because a grade does not exist until the work is marked) and the `enrolled_on` date. A `UNIQUE (student_id, course_id)` constraint stops the same student enrolling on the same course twice.

## Relationships

- **students → enrolments is one-to-many:** one student can have many enrolments, but each enrolment belongs to exactly one student.
- **courses → enrolments is one-to-many:** one course can have many enrolments, but each enrolment belongs to exactly one course.
- **students ↔ courses is many-to-many:** a student takes several courses, and a course has several students. This is the combination of the two one-to-many relationships above.

A join table (`enrolments`) is needed because a relational column holds a single value. We cannot put a list of course ids inside a student row, or a list of student ids inside a course row, without breaking the rules of normalisation (repeated groups, hard to query, hard to keep consistent). The join table turns one many-to-many relationship into two one-to-many ones, with one row per pairing. It is also the natural home for data that belongs to the *pairing* rather than to either side: the grade and enrolment date.

## Index

I would add an index on `enrolments(course_id)`:

```sql
CREATE INDEX idx_enrolments_course_id ON enrolments(course_id);
```

The `UNIQUE (student_id, course_id)` constraint already creates an index that serves lookups starting from the student. Queries that start from the course ("all students on this course", "students per course") have no index to use, so SQLite would scan the whole enrolments table. An index on `course_id` makes these lookups and the joins on that column fast as the table grows to thousands of rows.

## SQL or NoSQL?

I would choose SQL (a relational database) for this system. The data is highly structured and the relationships are central to it: students, courses and enrolments are all linked, and the questions we ask are relational ("which students are on this course?", "who has no enrolments?"). SQL handles these with joins and aggregates. It also enforces integrity for us: foreign keys prevent enrolments for students or courses that do not exist, and unique constraints prevent duplicate emails and duplicate enrolments. Grades and enrolments matter, so we also want transactions so that updates are all-or-nothing. A NoSQL document store would suit data that is flexible, nested or needs to scale across many servers (such as activity logs or user profiles with varying fields), but a school's data is small, consistent and relational, so those benefits would not outweigh the loss of joins and built-in consistency.
