# MITM EduOs AI Portal

MITM EduOs is a full-stack academic portal for engineering colleges with role-based access for faculty/HOD and students.  
It combines record management (attendance, internal marks, syllabus, notes) with AI-assisted academic workflows (lesson plan generation, question paper drafting, quizzes, and expert chat).

## Features

- Role-based authentication (`student`, `faculty`, `hod`) with JWT
- Attendance management (faculty CRUD, student self-view)
- Internal marks management (faculty CRUD, student self-view)
- Syllabus management and publishing
- Notes vault with upload/list/delete flow
- AI endpoints for:
  - Syllabus support
  - Notes/resource guidance
  - Teacher tasks (lesson plan, question paper, quiz, doc analysis)
  - Expert academic chat

## Tech Stack

- Frontend: React, TypeScript, Vite
- Backend: FastAPI (Python)
- Auth: JWT (`python-jose`)
- Password hashing: `passlib`
- AI: Groq API (OpenAI-compatible chat endpoint)
- Persistence: Local JSON file store (configured via `DATA_FILE`)

## Project Structure

```text
mitm eduos 2/
|- App.tsx
|- components/
|  |- Layout.tsx
|  |- SearchPanel.tsx
|  |- ResultDisplay.tsx
|- services/
|  |- backendService.ts
|  |- groqService.ts
|  |- geminiService.ts
|- backend/
|  |- main.py
|  |- requirements.txt
|  |- .env.example
|- package.json
|- README.md
```

## Prerequisites

- Node.js 18+
- Python 3.10+

## Environment Configuration

### Frontend (`.env.local` at project root)

```env
VITE_API_URL=http://127.0.0.1:8001
```

### Backend (`backend/.env`)

Create from `backend/.env.example`:

```env
DATA_FILE=./data/store.json
JWT_SECRET=replace_with_long_random_secret
GROQ_API_KEY=replace_with_groq_key
FRONTEND_ORIGIN=http://localhost:3000
AUTO_SEED_USERS=true
```

Notes:
- `JWT_SECRET` and `GROQ_API_KEY` are required for full functionality.
- `DATA_FILE` controls where local backend data is stored.
- `AUTO_SEED_USERS=true` seeds demo users at startup.

## Local Setup

### 1) Frontend

```powershell
cd "C:\Users\SHREYA\Downloads\mitm eduos\mitm eduos 2"
npm install
npm run dev
```

Frontend runs at `http://localhost:3000`.

### 2) Backend

```powershell
cd "C:\Users\SHREYA\Downloads\mitm eduos\mitm eduos 2\backend"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

Backend runs at `http://127.0.0.1:8001`.

## NPM Scripts

- `npm run dev` - start Vite dev server
- `npm run build` - build production bundle
- `npm run preview` - preview production build

## Data Persistence

- Backend persists app data in a JSON file.
- Default file path: `backend/data/store.json`
- This file is created automatically when backend initializes.

## API Overview

### Health and diagnostics

- `GET /health`
- `GET /db-check`

### Auth

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/seed-users`
- `GET /auth/me`

### Notes

- `GET /notes`
- `POST /notes`
- `DELETE /notes/{note_id}`

### Attendance

- `GET /attendance`
- `POST /attendance`
- `GET /attendance/{attendance_id}`
- `PUT /attendance/{attendance_id}`
- `DELETE /attendance/{attendance_id}`

### Marks

- `GET /marks`
- `POST /marks`
- `GET /marks/{mark_id}`
- `PUT /marks/{mark_id}`
- `DELETE /marks/{mark_id}`

### Syllabus

- `GET /syllabus`
- `POST /syllabus`
- `GET /syllabus/{syllabus_id}`
- `PUT /syllabus/{syllabus_id}`
- `DELETE /syllabus/{syllabus_id}`

### AI

- `POST /ai/syllabus`
- `POST /ai/notes`
- `POST /ai/task`
- `POST /ai/chat`

## Default Seed Accounts (Demo)

If `AUTO_SEED_USERS=true`, default demo users are created:

- Faculty:
  - `login_id`: `FCLT001`
  - `password`: `Faculty@123`
- Students:
  - `login_id`: `4MH23IS001` to `4MH23IS010`
  - `password`: `Student@123`

## Security Notes

- Change default seeded credentials before non-demo use.
- Use a strong `JWT_SECRET`.
- Restrict `FRONTEND_ORIGIN` in production.
- Treat uploaded file payloads and JSON data as sensitive.

## Troubleshooting

- Backend import errors: ensure virtual env is activated and `pip install -r requirements.txt` completed.
- Frontend cannot reach backend: verify `VITE_API_URL` and backend running on port `8001`.
- CORS issues: confirm `FRONTEND_ORIGIN` matches frontend URL.
- AI errors: verify `GROQ_API_KEY` and outbound network access from backend.
