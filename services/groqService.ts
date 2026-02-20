import { ResourceLink, SearchState } from '../types';
import { aiChat, aiFindNotes, aiFindSyllabus, aiTeacherTask } from './backendService';

export const findVTUSyllabus = async (
  token: string,
  search: SearchState
): Promise<{ text: string; links: ResourceLink[] }> => {
  return aiFindSyllabus(token, search);
};

export const findVTUNotes = async (
  token: string,
  search: SearchState
): Promise<{ text: string; links: ResourceLink[] }> => {
  return aiFindNotes(token, search);
};

export const teacherAssistantTask = async (
  token: string,
  task: 'LESSON' | 'QP' | 'QUIZ' | 'DOC_ANALYZE',
  search: SearchState
): Promise<{ text: string }> => {
  return aiTeacherTask(token, task, search);
};

export const chatWithExpert = async (
  token: string,
  message: string,
  history: any[],
  search: SearchState
): Promise<{ text: string }> => {
  return aiChat(token, message, history, search);
};
