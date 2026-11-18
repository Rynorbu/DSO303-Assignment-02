-- Schema for the exam platform (PostgreSQL 16). Safe to run repeatedly (applied on every deploy).

CREATE TABLE IF NOT EXISTS exams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text        NOT NULL,
  tutor_sub        text        NOT NULL,
  tutor_email      text,
  duration_minutes int         NOT NULL CHECK (duration_minutes > 0),
  opens_at         timestamptz,
  closes_at        timestamptz,
  questions        jsonb       NOT NULL,  -- [{id, type: mcq|short, text, options[], answer, marks}]
  results_released boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE exams ADD COLUMN IF NOT EXISTS description text;
CREATE INDEX IF NOT EXISTS exams_tutor_idx ON exams (tutor_sub);

CREATE TABLE IF NOT EXISTS attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id       uuid        NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_sub   text        NOT NULL,
  student_email text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  deadline      timestamptz NOT NULL,
  answers       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_saved_at timestamptz,
  submitted_at  timestamptz,
  status        text        NOT NULL DEFAULT 'in_progress', -- in_progress | submitted | awaiting_manual | marked
  mcq_score     numeric,
  manual_score  numeric,
  total_score   numeric,
  max_score     numeric,
  UNIQUE (exam_id, student_sub)
);
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS manual_marks jsonb NOT NULL DEFAULT '{}'::jsonb; -- {questionId: marks}
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS feedback text;
CREATE INDEX IF NOT EXISTS attempts_student_idx ON attempts (student_sub);
CREATE INDEX IF NOT EXISTS attempts_open_idx ON attempts (deadline) WHERE status = 'in_progress';

CREATE TABLE IF NOT EXISTS assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL,
  tutor_sub   text        NOT NULL,
  tutor_email text,
  due_at      timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS description text;

CREATE TABLE IF NOT EXISTS submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid        NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_sub   text        NOT NULL,
  student_email text,
  s3_key        text        NOT NULL UNIQUE,
  size_bytes    bigint      NOT NULL,
  submitted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submissions_assignment_idx ON submissions (assignment_id);
CREATE INDEX IF NOT EXISTS submissions_student_idx ON submissions (student_sub);
