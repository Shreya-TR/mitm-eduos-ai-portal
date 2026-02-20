
export enum AppTab {
  SYLLABUS = 'SYLLABUS',
  NOTES = 'NOTES',
  LESSON_PLAN = 'LESSON_PLAN',
  QP_GEN = 'QP_GEN',
  QUIZ_GEN = 'QUIZ_GEN',
  DOC_INSIGHTS = 'DOC_INSIGHTS',
  AI_SEARCH = 'AI_SEARCH',
  HOD_RULES = 'HOD_RULES',
  NOTE_VAULT = 'NOTE_VAULT',
  ATTENDANCE = 'ATTENDANCE',
  INTERNAL_MARKS = 'INTERNAL_MARKS',
  SYLLABUS_MGMT = 'SYLLABUS_MGMT'
}

export type UserType = 'teacher' | 'student' | null;

export interface AttendanceRecord {
  id: string;
  usn: string;
  subject: string;
  dateRange: string;
  classesConducted: number;
  classesAttended: number;
}

export interface MarkRecord {
  id: string;
  usn: string;
  subject: string;
  internal1: string;
  internal2: string;
  internal3: string;
}

export interface SyllabusEntry {
  id: string;
  branch: string;
  semester: string;
  subject: string;
  subjectCode: string;
  content: string;
  fileName?: string;
  fileData?: string;
  fileType?: string;
}

export interface SearchState {
  scheme: string;
  branch: string;
  semester: string;
  subject: string;
  qpType: 'INTERNAL_40' | 'FINAL_100';
  numClasses: string;
  difficulty: string;
  hodRules: string;
  numPartA: string;
  numPartB: string;
  pdfBase64?: string;
  syllabusPdfBase64?: string;
  notesPdfBase64?: string;
}

export interface ResourceLink {
  title: string;
  url: string;
}

export interface NoteEntry {
  id: string;
  title: string;
  subject: string;
  branch: string;
  semester: string;
  scheme: string;
  fileName: string;
  fileData: string;
  fileType: string;
  uploadedBy: string;
  timestamp: number;
}
