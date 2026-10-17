-- Day 6: School database (students, courses, enrolments)
-- Runs in SQLite (e.g. sqliteonline.com)

PRAGMA foreign_keys = ON;

-- Clean re-runs: drop child table first
DROP TABLE IF EXISTS enrolments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS students;

-- ---------- TABLES ----------

CREATE TABLE students (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
);

CREATE TABLE courses (
    id      INTEGER PRIMARY KEY,
    title   TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 10
);

CREATE TABLE enrolments (
    id          INTEGER PRIMARY KEY,
    student_id  INTEGER NOT NULL,
    course_id   INTEGER NOT NULL,
    grade       TEXT,  -- NULL until the course has been marked
    enrolled_on TEXT NOT NULL DEFAULT (date('now')),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (course_id)  REFERENCES courses(id),
    -- the same student cannot enrol on the same course twice
    UNIQUE (student_id, course_id)
);

-- ---------- SAMPLE DATA ----------

INSERT INTO students (id, name, email) VALUES
    (1, 'Amina Otieno',  'amina@example.com'),
    (2, 'Brian Kamau',   'brian@example.com'),
    (3, 'Chloe Mwangi',  'chloe@example.com'),
    (4, 'David Njoroge', 'david@example.com');   -- will have no enrolments

INSERT INTO courses (id, title, credits) VALUES
    (1, 'Web Foundations', 10),
    (2, 'Databases',       10),
    (3, 'JavaScript',      15);

INSERT INTO enrolments (student_id, course_id, grade, enrolled_on) VALUES
    (1, 1, 'A',  '2026-09-01'),
    (1, 2, 'B',  '2026-09-01'),
    (2, 1, 'B',  '2026-09-02'),
    (2, 3, NULL, '2026-09-02'),
    (3, 1, 'C',  '2026-09-03'),
    (3, 2, NULL, '2026-09-03');

-- ---------- QUERIES ----------

-- 1. All courses for one student (by name)
SELECT c.title, e.grade
FROM students s
JOIN enrolments e ON e.student_id = s.id
JOIN courses c    ON c.id = e.course_id
WHERE s.name = 'Amina Otieno';

-- 2. All students on one course
SELECT s.name, s.email, e.grade
FROM courses c
JOIN enrolments e ON e.course_id = c.id
JOIN students s   ON s.id = e.student_id
WHERE c.title = 'Web Foundations';

-- 3. Number of students per course (includes courses with 0 students)
SELECT c.title, COUNT(e.id) AS student_count
FROM courses c
LEFT JOIN enrolments e ON e.course_id = c.id
GROUP BY c.id, c.title
ORDER BY student_count DESC;

-- 4. Students who have no enrolments
SELECT s.id, s.name
FROM students s
LEFT JOIN enrolments e ON e.student_id = s.id
WHERE e.id IS NULL;

-- 5. Update one enrolment's grade (Brian's JavaScript grade)
UPDATE enrolments
SET grade = 'A'
WHERE student_id = (SELECT id FROM students WHERE name = 'Brian Kamau')
  AND course_id  = (SELECT id FROM courses  WHERE title = 'JavaScript');

-- Check the update worked
SELECT s.name, c.title, e.grade
FROM enrolments e
JOIN students s ON s.id = e.student_id
JOIN courses c  ON c.id = e.course_id
WHERE s.name = 'Brian Kamau';