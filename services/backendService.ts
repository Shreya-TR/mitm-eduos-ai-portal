import {
  AttendanceRecord,
  MarkRecord,
  NoteEntry,
  ResourceLink,
  SearchState,
  SyllabusEntry
} from '../types';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8001').replace(/\/+$/, '');

export type BackendRole = 'student' | 'faculty' | 'hod';

export interface BackendUser {
  id: string;
  login_id: string;
  full_name: string;
  role: BackendRole;
  branch?: string | null;
  semester?: string | null;
}

interface BackendLoginResponse {
  access_token: string;
  token_type: string;
  user: BackendUser;
}

interface BackendNote {
  id: string;
  title: string;
  subject: string;
  branch: string;
  semester: string;
  scheme?: string | null;
  fileName: string;
  fileData: string;
  fileType?: string | null;
  uploadedBy: string;
  timestamp: number;
}

interface AIResponse {
  text: string;
  links?: ResourceLink[];
}

const parseErrorMessage = async (res: Response) => {
  try {
    const data = await res.json();
    if (typeof data?.detail === 'string') return data.detail;
    if (typeof data?.error === 'string') return data.error;
  } catch {
    // Ignore JSON parse failures and fall back to status text.
  }
  return `${res.status} ${res.statusText}`;
};

const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new Error(`Cannot reach backend at ${API_BASE}. Start backend and verify VITE_API_URL.`);
  }
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }
  return res.json();
};

const withAuth = (token: string, extraHeaders: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`,
  ...extraHeaders
});

const scoreToNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toQueryString = (params: Record<string, string | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value && value.trim()) {
      query.set(key, value.trim());
    }
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
};

const toNoteEntry = (row: BackendNote): NoteEntry => ({
  id: row.id,
  title: row.title,
  subject: row.subject,
  branch: row.branch,
  semester: row.semester,
  scheme: row.scheme || '',
  fileName: row.fileName,
  fileData: row.fileData,
  fileType: row.fileType || '',
  uploadedBy: row.uploadedBy,
  timestamp: row.timestamp
});

export const loginWithBackend = async (loginId: string, password: string): Promise<BackendLoginResponse> => {
  return requestJson<BackendLoginResponse>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login_id: loginId.trim(),
      password
    })
  });
};

export const getAttendanceRecords = async (token: string): Promise<AttendanceRecord[]> => {
  return requestJson<AttendanceRecord[]>('/attendance', {
    headers: withAuth(token)
  });
};

export const createAttendanceRecord = async (
  token: string,
  payload: Omit<AttendanceRecord, 'id'>
): Promise<AttendanceRecord> => {
  return requestJson<AttendanceRecord>('/attendance', {
    method: 'POST',
    headers: withAuth(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
};

export const getMarksRecords = async (token: string): Promise<MarkRecord[]> => {
  const rows = await requestJson<Array<{
    id: string;
    usn: string;
    subject: string;
    internal1: number | null;
    internal2: number | null;
    internal3: number | null;
  }>>('/marks', {
    headers: withAuth(token)
  });

  return rows.map((row) => ({
    id: row.id,
    usn: row.usn,
    subject: row.subject,
    internal1: row.internal1 == null ? '' : String(row.internal1),
    internal2: row.internal2 == null ? '' : String(row.internal2),
    internal3: row.internal3 == null ? '' : String(row.internal3)
  }));
};

export const createMarkRecord = async (
  token: string,
  payload: Omit<MarkRecord, 'id'>
): Promise<MarkRecord> => {
  const created = await requestJson<{
    id: string;
    usn: string;
    subject: string;
    internal1: number | null;
    internal2: number | null;
    internal3: number | null;
  }>('/marks', {
    method: 'POST',
    headers: withAuth(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      usn: payload.usn,
      subject: payload.subject,
      internal1: payload.internal1 ? scoreToNumber(payload.internal1) : null,
      internal2: payload.internal2 ? scoreToNumber(payload.internal2) : null,
      internal3: payload.internal3 ? scoreToNumber(payload.internal3) : null
    })
  });

  return {
    id: created.id,
    usn: created.usn,
    subject: created.subject,
    internal1: created.internal1 == null ? '' : String(created.internal1),
    internal2: created.internal2 == null ? '' : String(created.internal2),
    internal3: created.internal3 == null ? '' : String(created.internal3)
  };
};

export const getSyllabusEntries = async (token: string): Promise<SyllabusEntry[]> => {
  return requestJson<SyllabusEntry[]>('/syllabus', {
    headers: withAuth(token)
  });
};

export const createSyllabusEntry = async (
  token: string,
  payload: Omit<SyllabusEntry, 'id'>
): Promise<SyllabusEntry> => {
  return requestJson<SyllabusEntry>('/syllabus', {
    method: 'POST',
    headers: withAuth(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
};

export const deleteSyllabusEntry = async (token: string, id: string): Promise<void> => {
  await requestJson<{ ok: boolean; deleted_id: string }>(`/syllabus/${id}`, {
    method: 'DELETE',
    headers: withAuth(token)
  });
};

export const getNotes = async (
  token: string,
  filters: Pick<SearchState, 'branch' | 'semester' | 'subject'>
): Promise<NoteEntry[]> => {
  const query = toQueryString({
    branch: filters.branch,
    semester: filters.semester,
    subject: filters.subject
  });
  const rows = await requestJson<BackendNote[]>(`/notes${query}`, {
    headers: withAuth(token)
  });
  return rows.map(toNoteEntry);
};

export const createNote = async (
  token: string,
  payload: {
    title: string;
    subject: string;
    branch: string;
    semester: string;
    scheme: string;
    fileName: string;
    fileData: string;
    fileType: string;
  }
): Promise<NoteEntry> => {
  const row = await requestJson<BackendNote>('/notes', {
    method: 'POST',
    headers: withAuth(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  return toNoteEntry(row);
};

export const deleteNote = async (token: string, id: string): Promise<void> => {
  await requestJson<{ ok: boolean; deleted_id: string }>(`/notes/${id}`, {
    method: 'DELETE',
    headers: withAuth(token)
  });
};

export const aiFindSyllabus = async (
  token: string,
  search: SearchState
): Promise<{ text: string; links: ResourceLink[] }> => {
  const response = await requestJson<AIResponse>('/ai/syllabus', {
    method: 'POST',
    headers: withAuth(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(search)
  });
  return {
    text: response.text || 'No syllabus found.',
    links: Array.isArray(response.links) ? response.links : []
  };
};

export const aiFindNotes = async (
  token: string,
  search: SearchState
): Promise<{ text: string; links: ResourceLink[] }> => {
  const response = await requestJson<AIResponse>('/ai/notes', {
    method: 'POST',
    headers: withAuth(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(search)
  });
  return {
    text: response.text || 'No notes found.',
    links: Array.isArray(response.links) ? response.links : []
  };
};

export const aiTeacherTask = async (
  token: string,
  task: 'LESSON' | 'QP' | 'QUIZ' | 'DOC_ANALYZE',
  search: SearchState
): Promise<{ text: string }> => {
  const response = await requestJson<AIResponse>('/ai/task', {
    method: 'POST',
    headers: withAuth(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ task, search })
  });
  return { text: response.text || 'Could not process task.' };
};

export const aiChat = async (
  token: string,
  message: string,
  history: any[],
  search: SearchState
): Promise<{ text: string }> => {
  const response = await requestJson<AIResponse>('/ai/chat', {
    method: 'POST',
    headers: withAuth(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message, history, search })
  });
  return { text: response.text || 'No response.' };
};
