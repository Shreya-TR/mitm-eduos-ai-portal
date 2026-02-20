import os
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from typing import Literal
import urllib.error
import urllib.request

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field
import psycopg
from psycopg.rows import dict_row

ENV_PATH = Path(__file__).with_name('.env')
load_dotenv(dotenv_path=ENV_PATH)

DATABASE_URL = os.getenv('DATABASE_URL', '').strip()
JWT_SECRET = os.getenv('JWT_SECRET', '').strip()
JWT_ALGORITHM = 'HS256'
JWT_EXPIRE_MINUTES = int(os.getenv('JWT_EXPIRE_MINUTES', '120'))
GROQ_API_KEY = os.getenv('GROQ_API_KEY', '').strip()
GROQ_MODEL = os.getenv('GROQ_MODEL', 'llama-3.3-70b-versatile').strip() or 'llama-3.3-70b-versatile'
GROQ_BASE_URL = os.getenv('GROQ_BASE_URL', 'https://api.groq.com').strip() or 'https://api.groq.com'

app = FastAPI(title='MITM EduOs API')

_default_origins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]
_configured_origins: list[str] = []
for raw_origin in os.getenv('FRONTEND_ORIGIN', '').split(','):
    normalized = raw_origin.strip().strip('"').strip("'").rstrip('/')
    if normalized:
        _configured_origins.append(normalized)

allow_origins = sorted(set(_default_origins + _configured_origins))
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_origin_regex=r'https?://(localhost|127\.0\.0\.1)(:\d+)?',
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Use PBKDF2 to avoid bcrypt backend compatibility issues on some Windows/Python setups.
pwd_context = CryptContext(schemes=['pbkdf2_sha256'], deprecated='auto')
bearer_scheme = HTTPBearer(auto_error=False)


class RegisterRequest(BaseModel):
    login_id: str = Field(min_length=3, max_length=100)
    full_name: str = Field(min_length=2, max_length=120)
    role: Literal['student', 'faculty', 'hod']
    password: str = Field(min_length=6, max_length=128)
    branch: str | None = None
    semester: str | None = None


class LoginRequest(BaseModel):
    login_id: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=6, max_length=128)


class UserPublic(BaseModel):
    id: str
    login_id: str
    full_name: str
    role: Literal['student', 'faculty', 'hod']
    branch: str | None = None
    semester: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: UserPublic


class AttendanceCreate(BaseModel):
    usn: str = Field(min_length=3, max_length=100)
    subject: str = Field(min_length=1, max_length=200)
    dateRange: str = Field(min_length=1, max_length=200)
    classesConducted: int = Field(ge=0)
    classesAttended: int = Field(ge=0)


class AttendanceUpdate(BaseModel):
    usn: str | None = None
    subject: str | None = None
    dateRange: str | None = None
    classesConducted: int | None = Field(default=None, ge=0)
    classesAttended: int | None = Field(default=None, ge=0)


class AttendanceOut(BaseModel):
    id: str
    usn: str
    subject: str
    dateRange: str
    classesConducted: int
    classesAttended: int


class MarksCreate(BaseModel):
    usn: str = Field(min_length=3, max_length=100)
    subject: str = Field(min_length=1, max_length=200)
    internal1: int | None = None
    internal2: int | None = None
    internal3: int | None = None


class MarksUpdate(BaseModel):
    usn: str | None = None
    subject: str | None = None
    internal1: int | None = None
    internal2: int | None = None
    internal3: int | None = None


class MarksOut(BaseModel):
    id: str
    usn: str
    subject: str
    internal1: int | None = None
    internal2: int | None = None
    internal3: int | None = None


class SyllabusCreate(BaseModel):
    branch: str = Field(min_length=1, max_length=120)
    semester: str = Field(min_length=1, max_length=120)
    subject: str = Field(min_length=1, max_length=200)
    subjectCode: str | None = None
    content: str | None = None
    fileName: str | None = None
    fileData: str | None = None
    fileType: str | None = None


class SyllabusUpdate(BaseModel):
    branch: str | None = None
    semester: str | None = None
    subject: str | None = None
    subjectCode: str | None = None
    content: str | None = None
    fileName: str | None = None
    fileData: str | None = None
    fileType: str | None = None


class SyllabusOut(BaseModel):
    id: str
    branch: str
    semester: str
    subject: str
    subjectCode: str | None = None
    content: str | None = None
    fileName: str | None = None
    fileData: str | None = None
    fileType: str | None = None


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    subject: str = Field(min_length=1, max_length=200)
    branch: str = Field(min_length=1, max_length=120)
    semester: str = Field(min_length=1, max_length=120)
    scheme: str | None = None
    fileName: str = Field(min_length=1, max_length=500)
    fileData: str = Field(min_length=1)
    fileType: str | None = None


class NoteOut(BaseModel):
    id: str
    title: str
    subject: str
    branch: str
    semester: str
    scheme: str | None = None
    fileName: str
    fileData: str
    fileType: str | None = None
    uploadedBy: str
    timestamp: int


class SearchStateIn(BaseModel):
    scheme: str
    branch: str
    semester: str
    subject: str = ''
    qpType: Literal['INTERNAL_40', 'FINAL_100'] = 'INTERNAL_40'
    numClasses: str = '40'
    difficulty: str = 'Medium'
    hodRules: str = ''
    numPartA: str = '5'
    numPartB: str = '5'
    pdfBase64: str | None = None
    syllabusPdfBase64: str | None = None
    notesPdfBase64: str | None = None


class AITaskRequest(BaseModel):
    task: Literal['LESSON', 'QP', 'QUIZ', 'DOC_ANALYZE']
    search: SearchStateIn


class AIChatRequest(BaseModel):
    message: str
    history: list[dict] = Field(default_factory=list)
    search: SearchStateIn


class AITextWithLinks(BaseModel):
    text: str
    links: list[dict[str, str]]


class AITextResponse(BaseModel):
    text: str


def get_db_connection() -> psycopg.Connection:
    if not DATABASE_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'DATABASE_URL missing in {ENV_PATH}',
        )
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, prepare_threshold=None)


def ensure_schema() -> None:
    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute('create extension if not exists pgcrypto;')
            cur.execute(
                '''
                create table if not exists users (
                  id uuid primary key default gen_random_uuid(),
                  login_id text unique not null,
                  full_name text not null,
                  role text not null check (role in ('student','faculty','hod')),
                  password_hash text not null,
                  branch text,
                  semester text,
                  created_at timestamptz default now()
                );
                '''
            )
            cur.execute(
                '''
                create table if not exists attendance (
                  id bigserial primary key,
                  student_id uuid not null references users(id) on delete cascade,
                  subject text not null,
                  date_range text not null,
                  classes_conducted int not null,
                  classes_attended int not null,
                  created_by uuid references users(id),
                  created_at timestamptz default now()
                );
                '''
            )
            cur.execute(
                '''
                create table if not exists marks (
                  id bigserial primary key,
                  student_id uuid not null references users(id) on delete cascade,
                  subject text not null,
                  internal1 int,
                  internal2 int,
                  internal3 int,
                  created_by uuid references users(id),
                  created_at timestamptz default now()
                );
                '''
            )
            cur.execute(
                '''
                create table if not exists syllabus (
                  id bigserial primary key,
                  branch text not null,
                  semester text not null,
                  subject text not null,
                  subject_code text,
                  content text,
                  file_name text,
                  file_data text,
                  file_type text,
                  created_by uuid references users(id),
                  created_at timestamptz default now()
                );
                '''
            )
            cur.execute(
                '''
                create table if not exists notes (
                  id bigserial primary key,
                  title text not null,
                  subject text not null,
                  branch text not null,
                  semester text not null,
                  scheme text,
                  file_name text not null,
                  file_data text not null,
                  file_type text,
                  uploaded_by uuid references users(id),
                  created_at timestamptz default now()
                );
                '''
            )
            # Backward-compatible migrations for older existing tables.
            cur.execute('alter table notes add column if not exists scheme text;')
            cur.execute('alter table notes add column if not exists file_type text;')
            cur.execute('alter table notes add column if not exists uploaded_by uuid references users(id);')
            cur.execute('alter table notes add column if not exists created_at timestamptz default now();')
        conn.commit()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)


def build_seed_users() -> list[dict[str, str | None]]:
    seed: list[dict[str, str | None]] = [
        {
            'login_id': 'FCLT001',
            'full_name': 'Faculty One',
            'role': 'faculty',
            'password': 'Faculty@123',
            'branch': None,
            'semester': None,
        }
    ]
    for idx in range(1, 11):
        seed.append(
            {
                'login_id': f'4MH23IS{idx:03d}',
                'full_name': f'Student {idx:02d}',
                'role': 'student',
                'password': 'Student@123',
                'branch': 'Information Science and Engineering (ISE)',
                'semester': '3rd Semester',
            }
        )
    return seed


def seed_default_users() -> None:
    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            for entry in build_seed_users():
                cur.execute(
                    '''
                    insert into users (login_id, full_name, role, password_hash, branch, semester)
                    values (%s, %s, %s, %s, %s, %s)
                    on conflict (login_id) do update
                    set
                      full_name = excluded.full_name,
                      role = excluded.role,
                      password_hash = excluded.password_hash,
                      branch = excluded.branch,
                      semester = excluded.semester
                    ''',
                    (
                        entry['login_id'],
                        entry['full_name'],
                        entry['role'],
                        hash_password(str(entry['password'])),
                        entry['branch'],
                        entry['semester'],
                    ),
                )
        conn.commit()


def create_access_token(user_id: str, role: str, login_id: str) -> str:
    if not JWT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'JWT_SECRET missing in {ENV_PATH}',
        )
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {
        'sub': user_id,
        'role': role,
        'login_id': login_id,
        'exp': expire,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def require_roles(user: dict, allowed: set[str]) -> None:
    if user['role'] not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Insufficient role permissions')


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Missing bearer token')

    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get('sub')
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid token payload')
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid or expired token')

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                select
                  id::text as id,
                  login_id,
                  full_name,
                  role,
                  branch,
                  semester
                from users
                where id = %s
                ''',
                (user_id,),
            )
            user = cur.fetchone()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='User not found')
    return user


def resolve_student_id(conn: psycopg.Connection, usn: str) -> str:
    normalized_usn = usn.strip()
    with conn.cursor() as cur:
        cur.execute(
            """
            select id::text as id
            from users
            where upper(trim(login_id)) = upper(trim(%s))
              and lower(trim(role)) = 'student'
            """,
            (normalized_usn,),
        )
        row = cur.fetchone()
        if not row:
            cur.execute(
                """
                select id::text as id
                from users
                where upper(trim(login_id)) = upper(trim(%s))
                """,
                (normalized_usn,),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f'Student not found: {usn}')
    return row['id']


def groq_complete(messages: list[dict], max_completion_tokens: int = 2048) -> str:
    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'GROQ_API_KEY missing in {ENV_PATH}',
        )

    payload = {
        'model': GROQ_MODEL,
        'messages': messages,
        'temperature': 0.3,
        'max_completion_tokens': max_completion_tokens,
        'stream': False,
    }

    request = urllib.request.Request(
        url=f'{GROQ_BASE_URL}/openai/v1/chat/completions',
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {GROQ_API_KEY}',
            'Accept': 'application/json',
            'User-Agent': 'MITM-EduOs/1.0',
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            body = response.read().decode('utf-8')
            data = json.loads(body)
    except urllib.error.HTTPError as exc:
        body = ''
        try:
            body = exc.read().decode('utf-8', errors='ignore')
        except Exception:
            body = str(exc)
        body_l = body.lower()
        if 'error code: 1010' in body_l or 'access denied' in body_l:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    'Groq access denied by upstream firewall (Cloudflare 1010). '
                    'Turn off VPN/proxy, try a different network, and rotate GROQ_API_KEY.'
                ),
            )
        if exc.code in (401, 403):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail='Groq rejected credentials. Verify GROQ_API_KEY and generate a new key if needed.',
            )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f'Groq HTTP error: {body[:500]}')
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f'Groq connection error: {exc.reason}')
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f'Groq unexpected error: {exc}')

    text = (
        data.get('choices', [{}])[0]
        .get('message', {})
        .get('content', '')
    )
    return (str(text) if text is not None else '').strip()


def normalize_history(history: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for item in history:
        role = item.get('role')
        if role == 'model':
            role = 'assistant'
        if role not in ('system', 'assistant', 'user'):
            role = 'user'

        content = ''
        if isinstance(item.get('content'), str):
            content = item.get('content', '')
        elif isinstance(item.get('parts'), list):
            parts = item.get('parts', [])
            content = '\n'.join(str(part.get('text', '')) for part in parts if isinstance(part, dict))
        elif isinstance(item.get('text'), str):
            content = item.get('text', '')

        content = content.strip()
        if content:
            normalized.append({'role': role, 'content': content})
    return normalized


def build_teacher_prompt(task: str, search: SearchStateIn) -> str:
    if task == 'LESSON':
        return f"""Create a professional, highly structured VTU-compliant lesson plan for {search.subject} ({search.branch}).
Scheme: {search.scheme}. Total classes available: {search.numClasses}.

REQUIRED STRUCTURE:
1. ### Course Objectives: List 3-5 core goals.
2. ### Detailed Schedule Table:
   Use a Markdown table with columns: | Module | Week/Lec | Detailed Topics | Teaching Method | Hours |.
   Ensure the topics are divided logically across the total {search.numClasses} classes.
3. ### Module Summary: Brief description of each of the 5 modules.
4. ### Course Outcomes (COs): List 5 measurable outcomes using Bloom's Taxonomy.
5. ### Recommended Textbooks: Standard VTU-approved references.

HOD Governance Rules to follow: {search.hodRules or 'None'}"""

    if task == 'QP':
        if search.qpType == 'INTERNAL_40':
            prompt = f"""Draft an INTERNAL question paper for {search.subject} ({search.branch}).
Scheme: {search.scheme}. Difficulty Level: {search.difficulty}.
MANDATORY PATTERN:
- Total marks must be exactly 40.
- Each question must be 10 marks.
- Create exactly 4 question slots (Q1 to Q4), each worth 10 marks.
- Each slot must contain optional questions from the same module: Qx(a) OR Qx(b).
- Cover modules in a balanced way.
- For every slot, first print a COMMON STEM line before (a) and (b).
- Under each slot, print "Answer any one:" and then (a) OR (b).
DIAGRAM MANDATE:
- Include at least ONE diagram-based question slot.
- For Data Structures / Algorithms topics, the diagram must be related to Binary Tree / Forest / Heap / Graph.
- Print the diagram as ASCII inside a fenced code block directly under that question option.
- If the subject is not diagram-heavy, include a relevant flowchart-style ASCII diagram.
STRICT SECTION ISOLATION RULES:
- Keep all answers out of the question section.
- Put answers only in a separate final section titled "### Answer Key".
OUTPUT FORMAT (Markdown):
### Internal QP (40 Marks)
Q1 (Module ...):
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
Q2 (Module ...):
Common Stem: Consider the following binary tree and answer any one:
```text
<insert required diagram if this is the diagram-based slot>
```
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
Q3 (Module ...):
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
Q4 (Module ...):
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
### Answer Key
Q1: a->..., b->...
Q2: a->..., b->...
Q3: a->..., b->...
Q4: a->...
HOD Governance Rules to follow: {search.hodRules or 'None'}"""
        else:
            prompt = f"""Draft a FINAL EXAM question paper for {search.subject} ({search.branch}).
Scheme: {search.scheme}. Difficulty Level: {search.difficulty}.
MANDATORY PATTERN:
- Total marks must be exactly 100.
- Every question must be 10 marks.
- Use all 5 modules.
- Every module must include optional questions.
- Create exactly 10 question slots total (2 slots per module), each 10 marks.
- Every slot must have two options from the same module: Qx(a) OR Qx(b).
- For every slot, print a COMMON STEM line before (a) and (b).
- Under each slot, print "Answer any one:" and then (a) OR (b).
DIAGRAM MANDATE:
- Include at least TWO diagram-based question slots.
- For Data Structures / Algorithms topics, include Binary Tree / Forest / Heap / Graph style diagrams.
- Render each required diagram as ASCII inside fenced code blocks below the question option.
STRICT SECTION ISOLATION RULES:
- Keep all answers out of the question section.
- Put answers only in a separate final section titled "### Answer Key".
OUTPUT FORMAT (Markdown):
### Final Exam QP (100 Marks)
#### Module 1
Q1:
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
Q2:
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
#### Module 2
Q3:
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
Q4:
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
#### Module 3
Q5:
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
Q6:
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
#### Module 4
Q7:
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
Q8:
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
#### Module 5
Q9:
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
Q10:
Common Stem: ...
Answer any one:
(a) ... (10 Marks) OR (b) ... (10 Marks)
```text
<insert required diagram blocks under the diagram-based questions>
```
### Answer Key
Q1: a->..., b->...
...
Q10: a->..., b->...
HOD Governance Rules to follow: {search.hodRules or 'None'}"""

        if search.pdfBase64 or search.syllabusPdfBase64 or search.notesPdfBase64:
            prompt += '\nUPLOADED CONTEXT FLAGS:\n'
            if search.syllabusPdfBase64:
                prompt += '- Syllabus PDF uploaded by faculty.\n'
            if search.notesPdfBase64:
                prompt += '- Notes PDF uploaded by faculty.\n'
            if search.pdfBase64:
                prompt += '- Generic reference PDF uploaded.\n'
            prompt += 'Use uploaded context signals while drafting questions.'
        return prompt

    if task == 'QUIZ':
        return f"""Generate 10 multiple-choice questions for {search.subject} ({search.branch}) Module 1.
STRICT SECTION ISOLATION RULES:
- Keep questions section answer-free.
- Do not reveal answers in the question statements or options.
- Provide answers only in a separate "### Answer Key" section.
- Provide explanations only in a separate "### Explanations" section.
OUTPUT FORMAT (Markdown):
### Questions
1. ...
...
### Answer Key
1. ...
...
### Explanations
1. ...
..."""

    return f'Analyze the uploaded document for {search.subject}. Provide a summary of core topics, important formulas, and 5 likely exam questions based on this content.'


def clip_text(value: str | None, limit: int = 600) -> str:
    if not value:
        return ''
    compact = ' '.join(str(value).split())
    if len(compact) <= limit:
        return compact
    return f'{compact[:limit].rstrip()}...'


def build_qp_reference_context(search: SearchStateIn) -> str:
    branch = search.branch.strip()
    semester = search.semester.strip()
    subject = search.subject.strip()

    syllabus_rows: list[dict] = []
    notes_rows: list[dict] = []

    try:
        with closing(get_db_connection()) as conn:
            with conn.cursor() as cur:
                syllabus_params: list[str] = [branch, semester]
                syllabus_subject_filter = ''
                if subject:
                    syllabus_subject_filter = ' and lower(trim(subject)) = lower(trim(%s))'
                    syllabus_params.append(subject)

                cur.execute(
                    f'''
                    select subject, subject_code, content, file_name
                    from syllabus
                    where branch = %s
                      and semester = %s
                      {syllabus_subject_filter}
                    order by created_at desc, id desc
                    limit 3
                    ''',
                    tuple(syllabus_params),
                )
                syllabus_rows = cur.fetchall()

                if not syllabus_rows and subject:
                    cur.execute(
                        '''
                        select subject, subject_code, content, file_name
                        from syllabus
                        where branch = %s
                          and semester = %s
                        order by created_at desc, id desc
                        limit 3
                        ''',
                        (branch, semester),
                    )
                    syllabus_rows = cur.fetchall()

                notes_params: list[str] = [branch, semester]
                notes_subject_filter = ''
                if subject:
                    notes_subject_filter = ' and lower(trim(subject)) = lower(trim(%s))'
                    notes_params.append(subject)

                cur.execute(
                    f'''
                    select title, subject, file_name, scheme
                    from notes
                    where branch = %s
                      and semester = %s
                      {notes_subject_filter}
                    order by created_at desc, id desc
                    limit 8
                    ''',
                    tuple(notes_params),
                )
                notes_rows = cur.fetchall()

                if not notes_rows and subject:
                    cur.execute(
                        '''
                        select title, subject, file_name, scheme
                        from notes
                        where branch = %s
                          and semester = %s
                        order by created_at desc, id desc
                        limit 8
                        ''',
                        (branch, semester),
                    )
                    notes_rows = cur.fetchall()
    except Exception as exc:
        return f'Could not load syllabus/notes context from DB: {exc}'

    lines = [
        f'Branch: {branch}',
        f'Semester: {semester}',
        f'Subject focus: {subject or "not specified"}',
    ]

    if syllabus_rows:
        lines.append('Syllabus references:')
        for idx, row in enumerate(syllabus_rows, start=1):
            subject_name = clip_text(row.get('subject'), 100) or 'N/A'
            subject_code = clip_text(row.get('subject_code'), 60)
            file_name = clip_text(row.get('file_name'), 120) or 'N/A'
            content = clip_text(row.get('content'), 700)
            code_suffix = f' ({subject_code})' if subject_code else ''
            lines.append(f'- S{idx}: {subject_name}{code_suffix}; file: {file_name}')
            if content:
                lines.append(f'  Topics: {content}')
    else:
        lines.append('Syllabus references: none found.')

    if notes_rows:
        lines.append('Notes references:')
        for idx, row in enumerate(notes_rows, start=1):
            title = clip_text(row.get('title'), 120) or 'Untitled'
            note_subject = clip_text(row.get('subject'), 100) or 'N/A'
            file_name = clip_text(row.get('file_name'), 120) or 'N/A'
            scheme = clip_text(row.get('scheme'), 60)
            scheme_suffix = f'; scheme: {scheme}' if scheme else ''
            lines.append(f'- N{idx}: {title} | subject: {note_subject} | file: {file_name}{scheme_suffix}')
    else:
        lines.append('Notes references: none found.')

    return '\n'.join(lines)


def ensure_qp_has_diagram(text: str, subject: str) -> str:
    normalized = (text or '').strip()
    if not normalized:
        normalized = '### Question Paper\nContent could not be generated.'
    if '```' in normalized:
        return normalized

    fallback = f"""

### Auto-Added Diagram Practice ({subject})
Use this diagram-focused question in the paper if required.

Q-Diagram: Construct the Binary Search Tree for the keys: 50, 30, 70, 20, 40, 60, 80 and explain one traversal.
```text
        50
       /  \\
     30    70
    / \\    / \\
  20  40 60  80
```
""".rstrip()
    return f'{normalized}\n{fallback}'

@app.on_event('startup')
def startup() -> None:
    ensure_schema()
    seed_default_users()


@app.get('/health')
def health() -> dict:
    return {'ok': True, 'service': 'mitm-eduos-backend'}


@app.get('/db-check')
def db_check() -> dict:
    if not DATABASE_URL:
        return {
            'ok': False,
            'error': f'DATABASE_URL missing in {ENV_PATH}',
        }

    try:
        with closing(get_db_connection()) as conn:
            with conn.cursor() as cur:
                cur.execute('select now();')
                db_time = cur.fetchone()['now']
        return {'ok': True, 'db': 'connected', 'time': str(db_time)}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}


@app.post('/auth/register', response_model=UserPublic)
def auth_register(payload: RegisterRequest) -> UserPublic:
    login_id = payload.login_id.strip()
    full_name = payload.full_name.strip()

    if not login_id or not full_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='login_id and full_name are required')

    password_hash = hash_password(payload.password)

    try:
        with closing(get_db_connection()) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    '''
                    insert into users (login_id, full_name, role, password_hash, branch, semester)
                    values (%s, %s, %s, %s, %s, %s)
                    returning
                      id::text as id,
                      login_id,
                      full_name,
                      role,
                      branch,
                      semester
                    ''',
                    (
                        login_id,
                        full_name,
                        payload.role,
                        password_hash,
                        payload.branch,
                        payload.semester,
                    ),
                )
                created_user = cur.fetchone()
            conn.commit()
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='login_id already exists')

    return UserPublic(**created_user)


@app.post('/auth/login', response_model=TokenResponse)
def auth_login(payload: LoginRequest) -> TokenResponse:
    login_id = payload.login_id.strip()

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                select
                  id::text as id,
                  login_id,
                  full_name,
                  role,
                  branch,
                  semester,
                  password_hash
                from users
                where login_id = %s
                ''',
                (login_id,),
            )
            user = cur.fetchone()

    if not user or not verify_password(payload.password, user['password_hash']):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid credentials')

    token = create_access_token(user['id'], user['role'], user['login_id'])

    public_user = {
        'id': user['id'],
        'login_id': user['login_id'],
        'full_name': user['full_name'],
        'role': user['role'],
        'branch': user['branch'],
        'semester': user['semester'],
    }

    return TokenResponse(access_token=token, user=UserPublic(**public_user))


@app.post('/auth/seed-users')
def auth_seed_users() -> dict:
    seed_default_users()
    return {
        'ok': True,
        'faculty': {'login_id': 'FCLT001', 'password': 'Faculty@123'},
        'students': {'from': '4MH23IS001', 'to': '4MH23IS010', 'password': 'Student@123'},
    }


@app.get('/auth/me', response_model=UserPublic)
def auth_me(current_user: dict = Depends(get_current_user)) -> UserPublic:
    return UserPublic(**current_user)


@app.get('/notes', response_model=list[NoteOut])
def list_notes(
    branch: str | None = Query(default=None),
    semester: str | None = Query(default=None),
    subject: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
) -> list[NoteOut]:
    params: list = []
    filters: list[str] = []

    if current_user['role'] == 'student':
        if current_user.get('branch'):
            filters.append('n.branch = %s')
            params.append(current_user['branch'])
        if current_user.get('semester'):
            filters.append('n.semester = %s')
            params.append(current_user['semester'])

    if branch:
        filters.append('n.branch = %s')
        params.append(branch)
    if semester:
        filters.append('n.semester = %s')
        params.append(semester)
    if subject:
        filters.append('n.subject = %s')
        params.append(subject)

    where_clause = f"where {' and '.join(filters)}" if filters else ''

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f'''
                select
                  n.id::text as id,
                  n.title,
                  n.subject,
                  n.branch,
                  n.semester,
                  n.scheme,
                  n.file_name as "fileName",
                  n.file_data as "fileData",
                  n.file_type as "fileType",
                  coalesce(u.login_id, 'faculty') as "uploadedBy",
                  (extract(epoch from n.created_at) * 1000)::bigint as timestamp
                from notes n
                left join users u on u.id = n.uploaded_by
                {where_clause}
                order by n.created_at desc, n.id desc
                ''',
                tuple(params),
            )
            rows = cur.fetchall()
    return [NoteOut(**row) for row in rows]


@app.post('/notes', response_model=NoteOut)
def create_note(payload: NoteCreate, current_user: dict = Depends(get_current_user)) -> NoteOut:
    require_roles(current_user, {'faculty', 'hod'})

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                insert into notes (
                  title,
                  subject,
                  branch,
                  semester,
                  scheme,
                  file_name,
                  file_data,
                  file_type,
                  uploaded_by
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                returning id
                ''',
                (
                    payload.title.strip(),
                    payload.subject.strip(),
                    payload.branch.strip(),
                    payload.semester.strip(),
                    payload.scheme,
                    payload.fileName,
                    payload.fileData,
                    payload.fileType,
                    current_user['id'],
                ),
            )
            inserted_id = cur.fetchone()['id']
        conn.commit()

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                select
                  n.id::text as id,
                  n.title,
                  n.subject,
                  n.branch,
                  n.semester,
                  n.scheme,
                  n.file_name as "fileName",
                  n.file_data as "fileData",
                  n.file_type as "fileType",
                  coalesce(u.login_id, 'faculty') as "uploadedBy",
                  (extract(epoch from n.created_at) * 1000)::bigint as timestamp
                from notes n
                left join users u on u.id = n.uploaded_by
                where n.id = %s
                ''',
                (inserted_id,),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail='Failed to create note')
    return NoteOut(**row)


@app.delete('/notes/{note_id}')
def delete_note(note_id: str, current_user: dict = Depends(get_current_user)) -> dict:
    require_roles(current_user, {'faculty', 'hod'})

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute('delete from notes where id = %s returning id', (note_id,))
            deleted = cur.fetchone()
        conn.commit()

    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Note not found')
    return {'ok': True, 'deleted_id': note_id}


@app.post('/ai/syllabus', response_model=AITextWithLinks)
def ai_syllabus(search: SearchStateIn, current_user: dict = Depends(get_current_user)) -> AITextWithLinks:
    prompt = (
        f'Find and summarize the official VTU syllabus for {search.branch}, {search.semester} under {search.scheme}. '
        'Provide a clear breakdown of modules. Focus on official university links.'
    )
    text = groq_complete([{'role': 'user', 'content': prompt}], max_completion_tokens=2048)
    return AITextWithLinks(text=text or 'No syllabus found.', links=[])


@app.post('/ai/notes', response_model=AITextWithLinks)
def ai_notes(search: SearchStateIn, current_user: dict = Depends(get_current_user)) -> AITextWithLinks:
    prompt = (
        f'Find DIRECT module-wise notes, PDF question banks, and study materials for the VTU subject "{search.subject}" '
        f'({search.branch}, {search.semester}).\n'
        'YOU MUST PRIORITIZE AND SEARCH SPECIFICALLY within these domains: '
        '"vtucode.in", "vtu-circle.com", "vtunotesforall.com", and "azdocuments.in".\n'
        'Do not provide generic university homepages. Provide direct resource page URLs where students can download PDFs.'
    )
    text = groq_complete([{'role': 'user', 'content': prompt}], max_completion_tokens=2048)
    return AITextWithLinks(text=text or 'No specific PDF notes indexed. Try refining the subject name.', links=[])


@app.post('/ai/task', response_model=AITextResponse)
def ai_task(payload: AITaskRequest, current_user: dict = Depends(get_current_user)) -> AITextResponse:
    require_roles(current_user, {'faculty', 'hod'})
    prompt = build_teacher_prompt(payload.task, payload.search)
    if payload.task == 'QP':
        reference_context = build_qp_reference_context(payload.search)
        prompt += f"""

REFERENCE MATERIAL FROM INTERNAL DATABASE (SYLLABUS + NOTES):
{reference_context}

REFERENCE USAGE RULES:
- Draft the question paper using the syllabus references first.
- Align phrasing/examples with note references where applicable.
- Prefer topics that appear in both syllabus and notes.
- Keep final output in the mandated QP format without extra commentary.
"""
    text = groq_complete([{'role': 'user', 'content': prompt}], max_completion_tokens=4096)
    if payload.task == 'QP':
        text = ensure_qp_has_diagram(text, payload.search.subject)
    return AITextResponse(text=text or 'Could not process task.')


@app.post('/ai/chat', response_model=AITextResponse)
def ai_chat(payload: AIChatRequest, current_user: dict = Depends(get_current_user)) -> AITextResponse:
    system_instruction = f"""You are MITM EduOs AI, a world-class engineering professor specialized in the VTU curriculum.
Current context: Branch: {payload.search.branch}, Sem: {payload.search.semester}, Scheme: {payload.search.scheme}.

CRITICAL OUTPUT RULES:
1. STRUCTURE: Always use Markdown. Use '###' for section headers, bolding for key terms, and bullet points for lists.
2. TECHNICAL DEPTH: Provide rigorous engineering explanations.
3. NUMERICALS: If a student asks for a problem, solve it step-by-step with LaTeX formatting (e.g., $$E = mc^2$$).
4. SUMMARY TABLES: Use Markdown tables when comparing concepts or technologies.
5. EXAM FOCUS: Highlight concepts frequently asked in VTU examinations.
6. CLARITY: Keep the tone professional, encouraging, and academic."""

    messages = [{'role': 'system', 'content': system_instruction}]
    messages.extend(normalize_history(payload.history))
    messages.append({'role': 'user', 'content': payload.message})
    text = groq_complete(messages, max_completion_tokens=2048)
    return AITextResponse(text=text or 'The expert terminal is currently recalibrating.')


@app.get('/attendance', response_model=list[AttendanceOut])
def list_attendance(
    usn: str | None = Query(default=None),
    subject: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
) -> list[AttendanceOut]:
    params: list = []
    filters: list[str] = []

    if current_user['role'] == 'student':
        filters.append('u.login_id = %s')
        params.append(current_user['login_id'])
    elif usn:
        filters.append('u.login_id = %s')
        params.append(usn)

    if subject:
        filters.append('a.subject = %s')
        params.append(subject)

    where_clause = f"where {' and '.join(filters)}" if filters else ''

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f'''
                select
                  a.id::text as id,
                  u.login_id as usn,
                  a.subject,
                  a.date_range as "dateRange",
                  a.classes_conducted as "classesConducted",
                  a.classes_attended as "classesAttended"
                from attendance a
                join users u on u.id = a.student_id
                {where_clause}
                order by a.created_at desc, a.id desc
                ''',
                tuple(params),
            )
            rows = cur.fetchall()
    return [AttendanceOut(**row) for row in rows]


@app.post('/attendance', response_model=AttendanceOut)
def create_attendance(payload: AttendanceCreate, current_user: dict = Depends(get_current_user)) -> AttendanceOut:
    require_roles(current_user, {'faculty', 'hod'})

    with closing(get_db_connection()) as conn:
        student_id = resolve_student_id(conn, payload.usn)
        with conn.cursor() as cur:
            cur.execute(
                '''
                insert into attendance (student_id, subject, date_range, classes_conducted, classes_attended, created_by)
                values (%s, %s, %s, %s, %s, %s)
                returning id
                ''',
                (
                    student_id,
                    payload.subject.strip(),
                    payload.dateRange.strip(),
                    payload.classesConducted,
                    payload.classesAttended,
                    current_user['id'],
                ),
            )
            inserted_id = cur.fetchone()['id']
        conn.commit()

    return get_attendance_by_id(str(inserted_id), current_user)


@app.get('/attendance/{attendance_id}', response_model=AttendanceOut)
def get_attendance_by_id(attendance_id: str, current_user: dict = Depends(get_current_user)) -> AttendanceOut:
    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                select
                  a.id::text as id,
                  u.login_id as usn,
                  a.subject,
                  a.date_range as "dateRange",
                  a.classes_conducted as "classesConducted",
                  a.classes_attended as "classesAttended"
                from attendance a
                join users u on u.id = a.student_id
                where a.id = %s
                ''',
                (attendance_id,),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Attendance record not found')

    if current_user['role'] == 'student' and row['usn'] != current_user['login_id']:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Not allowed to view this record')

    return AttendanceOut(**row)


@app.put('/attendance/{attendance_id}', response_model=AttendanceOut)
def update_attendance(
    attendance_id: str,
    payload: AttendanceUpdate,
    current_user: dict = Depends(get_current_user),
) -> AttendanceOut:
    require_roles(current_user, {'faculty', 'hod'})

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                select id, student_id::text as student_id, subject, date_range, classes_conducted, classes_attended
                from attendance
                where id = %s
                ''',
                (attendance_id,),
            )
            existing = cur.fetchone()

        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Attendance record not found')

        student_id = existing['student_id']
        if payload.usn:
            student_id = resolve_student_id(conn, payload.usn)

        updated_subject = payload.subject if payload.subject is not None else existing['subject']
        updated_date_range = payload.dateRange if payload.dateRange is not None else existing['date_range']
        updated_conducted = payload.classesConducted if payload.classesConducted is not None else existing['classes_conducted']
        updated_attended = payload.classesAttended if payload.classesAttended is not None else existing['classes_attended']

        with conn.cursor() as cur:
            cur.execute(
                '''
                update attendance
                set student_id = %s,
                    subject = %s,
                    date_range = %s,
                    classes_conducted = %s,
                    classes_attended = %s
                where id = %s
                ''',
                (
                    student_id,
                    updated_subject,
                    updated_date_range,
                    updated_conducted,
                    updated_attended,
                    attendance_id,
                ),
            )
        conn.commit()

    return get_attendance_by_id(attendance_id, current_user)


@app.delete('/attendance/{attendance_id}')
def delete_attendance(attendance_id: str, current_user: dict = Depends(get_current_user)) -> dict:
    require_roles(current_user, {'faculty', 'hod'})

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute('delete from attendance where id = %s returning id', (attendance_id,))
            deleted = cur.fetchone()
        conn.commit()

    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Attendance record not found')
    return {'ok': True, 'deleted_id': attendance_id}


@app.get('/marks', response_model=list[MarksOut])
def list_marks(
    usn: str | None = Query(default=None),
    subject: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
) -> list[MarksOut]:
    params: list = []
    filters: list[str] = []

    if current_user['role'] == 'student':
        filters.append('u.login_id = %s')
        params.append(current_user['login_id'])
    elif usn:
        filters.append('u.login_id = %s')
        params.append(usn)

    if subject:
        filters.append('m.subject = %s')
        params.append(subject)

    where_clause = f"where {' and '.join(filters)}" if filters else ''

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f'''
                select
                  m.id::text as id,
                  u.login_id as usn,
                  m.subject,
                  m.internal1,
                  m.internal2,
                  m.internal3
                from marks m
                join users u on u.id = m.student_id
                {where_clause}
                order by m.created_at desc, m.id desc
                ''',
                tuple(params),
            )
            rows = cur.fetchall()

    return [MarksOut(**row) for row in rows]


@app.get('/marks/{mark_id}', response_model=MarksOut)
def get_marks_by_id(mark_id: str, current_user: dict = Depends(get_current_user)) -> MarksOut:
    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                select
                  m.id::text as id,
                  u.login_id as usn,
                  m.subject,
                  m.internal1,
                  m.internal2,
                  m.internal3
                from marks m
                join users u on u.id = m.student_id
                where m.id = %s
                ''',
                (mark_id,),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Marks record not found')

    if current_user['role'] == 'student' and row['usn'] != current_user['login_id']:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Not allowed to view this record')

    return MarksOut(**row)


@app.post('/marks', response_model=MarksOut)
def create_marks(payload: MarksCreate, current_user: dict = Depends(get_current_user)) -> MarksOut:
    require_roles(current_user, {'faculty', 'hod'})

    with closing(get_db_connection()) as conn:
        student_id = resolve_student_id(conn, payload.usn)

        with conn.cursor() as cur:
            cur.execute(
                '''
                insert into marks (student_id, subject, internal1, internal2, internal3, created_by)
                values (%s, %s, %s, %s, %s, %s)
                returning id
                ''',
                (
                    student_id,
                    payload.subject.strip(),
                    payload.internal1,
                    payload.internal2,
                    payload.internal3,
                    current_user['id'],
                ),
            )
            inserted_id = cur.fetchone()['id']
        conn.commit()

    return get_marks_by_id(str(inserted_id), current_user)


@app.put('/marks/{mark_id}', response_model=MarksOut)
def update_marks(mark_id: str, payload: MarksUpdate, current_user: dict = Depends(get_current_user)) -> MarksOut:
    require_roles(current_user, {'faculty', 'hod'})

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                select id, student_id::text as student_id, subject, internal1, internal2, internal3
                from marks
                where id = %s
                ''',
                (mark_id,),
            )
            existing = cur.fetchone()

        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Marks record not found')

        student_id = existing['student_id']
        if payload.usn:
            student_id = resolve_student_id(conn, payload.usn)

        with conn.cursor() as cur:
            cur.execute(
                '''
                update marks
                set student_id = %s,
                    subject = %s,
                    internal1 = %s,
                    internal2 = %s,
                    internal3 = %s
                where id = %s
                ''',
                (
                    student_id,
                    payload.subject if payload.subject is not None else existing['subject'],
                    payload.internal1 if payload.internal1 is not None else existing['internal1'],
                    payload.internal2 if payload.internal2 is not None else existing['internal2'],
                    payload.internal3 if payload.internal3 is not None else existing['internal3'],
                    mark_id,
                ),
            )
        conn.commit()

    return get_marks_by_id(mark_id, current_user)


@app.delete('/marks/{mark_id}')
def delete_marks(mark_id: str, current_user: dict = Depends(get_current_user)) -> dict:
    require_roles(current_user, {'faculty', 'hod'})

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute('delete from marks where id = %s returning id', (mark_id,))
            deleted = cur.fetchone()
        conn.commit()

    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Marks record not found')
    return {'ok': True, 'deleted_id': mark_id}


@app.get('/syllabus', response_model=list[SyllabusOut])
def list_syllabus(
    branch: str | None = Query(default=None),
    semester: str | None = Query(default=None),
    subject: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
) -> list[SyllabusOut]:
    params: list = []
    filters: list[str] = []

    if branch:
        filters.append('s.branch = %s')
        params.append(branch)
    if semester:
        filters.append('s.semester = %s')
        params.append(semester)
    if subject:
        filters.append('s.subject = %s')
        params.append(subject)

    where_clause = f"where {' and '.join(filters)}" if filters else ''

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f'''
                select
                  s.id::text as id,
                  s.branch,
                  s.semester,
                  s.subject,
                  s.subject_code as "subjectCode",
                  s.content,
                  s.file_name as "fileName",
                  s.file_data as "fileData",
                  s.file_type as "fileType"
                from syllabus s
                {where_clause}
                order by s.created_at desc, s.id desc
                ''',
                tuple(params),
            )
            rows = cur.fetchall()

    return [SyllabusOut(**row) for row in rows]


@app.get('/syllabus/{syllabus_id}', response_model=SyllabusOut)
def get_syllabus_by_id(syllabus_id: str, current_user: dict = Depends(get_current_user)) -> SyllabusOut:
    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                select
                  s.id::text as id,
                  s.branch,
                  s.semester,
                  s.subject,
                  s.subject_code as "subjectCode",
                  s.content,
                  s.file_name as "fileName",
                  s.file_data as "fileData",
                  s.file_type as "fileType"
                from syllabus s
                where s.id = %s
                ''',
                (syllabus_id,),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Syllabus record not found')

    return SyllabusOut(**row)


@app.post('/syllabus', response_model=SyllabusOut)
def create_syllabus(payload: SyllabusCreate, current_user: dict = Depends(get_current_user)) -> SyllabusOut:
    require_roles(current_user, {'faculty', 'hod'})

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                insert into syllabus (
                    branch,
                    semester,
                    subject,
                    subject_code,
                    content,
                    file_name,
                    file_data,
                    file_type,
                    created_by
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                returning id
                ''',
                (
                    payload.branch,
                    payload.semester,
                    payload.subject,
                    payload.subjectCode,
                    payload.content,
                    payload.fileName,
                    payload.fileData,
                    payload.fileType,
                    current_user['id'],
                ),
            )
            inserted_id = cur.fetchone()['id']
        conn.commit()

    return get_syllabus_by_id(str(inserted_id), current_user)


@app.put('/syllabus/{syllabus_id}', response_model=SyllabusOut)
def update_syllabus(syllabus_id: str, payload: SyllabusUpdate, current_user: dict = Depends(get_current_user)) -> SyllabusOut:
    require_roles(current_user, {'faculty', 'hod'})

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                select
                  id,
                  branch,
                  semester,
                  subject,
                  subject_code,
                  content,
                  file_name,
                  file_data,
                  file_type
                from syllabus
                where id = %s
                ''',
                (syllabus_id,),
            )
            existing = cur.fetchone()

        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Syllabus record not found')

        with conn.cursor() as cur:
            cur.execute(
                '''
                update syllabus
                set branch = %s,
                    semester = %s,
                    subject = %s,
                    subject_code = %s,
                    content = %s,
                    file_name = %s,
                    file_data = %s,
                    file_type = %s
                where id = %s
                ''',
                (
                    payload.branch if payload.branch is not None else existing['branch'],
                    payload.semester if payload.semester is not None else existing['semester'],
                    payload.subject if payload.subject is not None else existing['subject'],
                    payload.subjectCode if payload.subjectCode is not None else existing['subject_code'],
                    payload.content if payload.content is not None else existing['content'],
                    payload.fileName if payload.fileName is not None else existing['file_name'],
                    payload.fileData if payload.fileData is not None else existing['file_data'],
                    payload.fileType if payload.fileType is not None else existing['file_type'],
                    syllabus_id,
                ),
            )
        conn.commit()

    return get_syllabus_by_id(syllabus_id, current_user)


@app.delete('/syllabus/{syllabus_id}')
def delete_syllabus(syllabus_id: str, current_user: dict = Depends(get_current_user)) -> dict:
    require_roles(current_user, {'faculty', 'hod'})

    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute('delete from syllabus where id = %s returning id', (syllabus_id,))
            deleted = cur.fetchone()
        conn.commit()

    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Syllabus record not found')
    return {'ok': True, 'deleted_id': syllabus_id}
