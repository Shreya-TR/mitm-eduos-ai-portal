
import React, { useState, useCallback, useRef, useEffect } from 'react';
import Layout from './components/Layout';
import SearchPanel from './components/SearchPanel';
import ResultDisplay from './components/ResultDisplay';
import { AppTab, SearchState, ResourceLink, UserType, NoteEntry, AttendanceRecord, MarkRecord, SyllabusEntry } from './types';
import { findVTUSyllabus, findVTUNotes, teacherAssistantTask, chatWithExpert } from './services/groqService';
import {
  createAttendanceRecord,
  createMarkRecord,
  createNote,
  createSyllabusEntry,
  deleteNote,
  deleteSyllabusEntry,
  getAttendanceRecords,
  getMarksRecords,
  getNotes,
  getSyllabusEntries,
  loginWithBackend
} from './services/backendService';
import { SCHEMES, BRANCHES, SEMESTERS } from './constants';

const MITM_LOGO_URL = 'https://notopedia-uploads.s3.us-east-2.amazonaws.com/clg-logo/logo-202007311306041945.png';

// --- Sub-Components Moved Outside to Prevent Unmounting/Focus Loss ---

interface ManagerProps {
  userType: UserType;
  userEmail: string; // Used for USN now
  authToken: string;
  search: SearchState;
  setSearch: React.Dispatch<React.SetStateAction<SearchState>>;
  isLoading: boolean;
  handleSearch: () => void;
  results: { summary: string, links: ResourceLink[] } | null;
  attendance: AttendanceRecord[];
  setAttendance: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  marks: MarkRecord[];
  setMarks: React.Dispatch<React.SetStateAction<MarkRecord[]>>;
  syllabusList: SyllabusEntry[];
  setSyllabusList: React.Dispatch<React.SetStateAction<SyllabusEntry[]>>;
  exportToExcel: (data: any[], fileName: string) => void;
}

const AttendanceManager: React.FC<ManagerProps> = ({ 
  userType, userEmail, authToken, search, attendance, setAttendance, exportToExcel 
}) => {
  const [usn, setUsn] = useState('');
  const [sub, setSub] = useState(search.subject);
  const [conducted, setConducted] = useState('20');
  const [attended, setAttended] = useState('18');
  const [dateRange, setDateRange] = useState('Block Entry');
  const [subjectFilter, setSubjectFilter] = useState<string>('All Subjects');
  
  const addRecord = async () => {
    if (!usn || !sub) return;
    if (!authToken) {
      alert('Session expired. Please login again.');
      return;
    }
    try {
      const created = await createAttendanceRecord(authToken, {
        usn,
        subject: sub,
        dateRange: dateRange || 'Recent Block',
        classesConducted: parseInt(conducted) || 0,
        classesAttended: parseInt(attended) || 0
      });
      setAttendance(prev => [created, ...prev]);
      setUsn('');
    } catch (err: any) {
      alert(err?.message || 'Failed to create attendance record.');
    }
  };

  if (userType === 'teacher') {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
        <div className="glass-panel p-8 rounded-[2.5rem] border border-white/5 shadow-2xl space-y-4">
          <div className="flex items-center gap-3">
             <i className="fas fa-layer-group text-blue-400"></i>
             <h3 className="text-xl font-black italic text-white uppercase tracking-tight">Bulk Attendance Entry (10-20 Days)</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <input type="text" placeholder="Student USN (e.g. 1MS21CS001)" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={usn} onChange={e => setUsn(e.target.value)} />
            <input type="text" placeholder="Subject" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={sub} onChange={e => setSub(e.target.value)} />
            <input type="text" placeholder="Date Range (e.g. Oct 1 - Oct 20)" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={dateRange} onChange={e => setDateRange(e.target.value)} />
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Classes Conducted</label>
              <input type="number" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={conducted} onChange={e => setConducted(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Student Attended</label>
              <input type="number" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={attended} onChange={e => setAttended(e.target.value)} />
            </div>
            <div className="flex items-end">
              <button onClick={addRecord} className="w-full bg-blue-600 text-white rounded-xl h-[46px] font-black text-xs uppercase hover:bg-blue-500 transition-colors">Commit Batch</button>
            </div>
          </div>
          <div className="flex gap-3 mt-4 items-center">
            <div className="flex-1">
              <input type="file" accept=".csv" id="attendanceCsv" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  (async () => {
                    if (!authToken) {
                      alert('Session expired. Please login again.');
                      return;
                    }

                    const text = String(reader.result || '');
                    const lines = text.split(/\r?\n/).filter(Boolean);
                    if (lines.length === 0) return;

                    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
                    const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim()));
                    const payloads = rows.map((cols) => {
                      const obj: any = {};
                      headers.forEach((h, i) => obj[h] = cols[i] ?? '');
                      return {
                        usn: obj['usn'] || obj['student_usn'] || obj['student'] || '',
                        subject: obj['subject'] || '',
                        dateRange: obj['daterange'] || obj['date_range'] || obj['date'] || 'Imported',
                        classesConducted: parseInt(obj['classesconducted'] || obj['conducted'] || '0') || 0,
                        classesAttended: parseInt(obj['classesattended'] || obj['attended'] || '0') || 0
                      };
                    }).filter((p) => p.usn && p.subject);

                    const createdRecords: AttendanceRecord[] = [];
                    for (const payload of payloads) {
                      try {
                        const created = await createAttendanceRecord(authToken, payload);
                        createdRecords.push(created);
                      } catch {
                        // Skip invalid rows and continue processing.
                      }
                    }

                    if (createdRecords.length > 0) {
                      setAttendance(prev => [...createdRecords, ...prev]);
                    }

                    if (createdRecords.length !== payloads.length) {
                      alert(`Imported ${createdRecords.length}/${payloads.length} attendance rows.`);
                    }
                  })();
                };
                reader.readAsText(file);
              }} />
              <label htmlFor="attendanceCsv" className="w-full cursor-pointer inline-flex items-center justify-center gap-3 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-slate-800 border border-slate-700 text-slate-400">Upload CSV (Attendance)</label>
            </div>
            <button onClick={() => exportToExcel(attendance, 'Attendance_Report')} className="text-blue-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:text-blue-300">
              <i className="fas fa-file-excel"></i> Export All to Excel
            </button>
          </div>
        </div>
        <div className="overflow-hidden glass-panel border border-white/5 rounded-3xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-900/50 uppercase font-black text-slate-500 tracking-widest border-b border-white/5">
              <tr><th className="p-4">Period</th><th className="p-4">USN</th><th className="p-4">Subject</th><th className="p-4">Conducted</th><th className="p-4">Attended</th><th className="p-4">%</th></tr>
            </thead>
            <tbody>
              {attendance.map(r => (
                <tr key={r.id} className="border-b border-white/5 text-slate-300">
                  <td className="p-4">{r.dateRange}</td><td className="p-4 font-bold">{r.usn}</td><td className="p-4">{r.subject}</td><td className="p-4">{r.classesConducted}</td><td className="p-4">{r.classesAttended}</td>
                  <td className="p-4 font-black text-blue-400">{r.classesConducted ? Math.round((r.classesAttended / r.classesConducted) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const myAttendance = attendance.filter(r => r.usn === userEmail);
  const subjects = ['All Subjects', ...Array.from(new Set(myAttendance.map(r => r.subject)))];
  const filteredAttendance = subjectFilter === 'All Subjects' ? myAttendance : myAttendance.filter(r => r.subject === subjectFilter);

  const totalConducted = filteredAttendance.reduce((acc, curr) => acc + curr.classesConducted, 0);
  const totalAttended = filteredAttendance.reduce((acc, curr) => acc + curr.classesAttended, 0);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <i className="fas fa-filter text-slate-500 text-xs"></i>
          <select 
            className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-black text-white uppercase outline-none focus:border-blue-500 transition-all"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
          >
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          MY USN: <span className="text-blue-500">{userEmail}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-6 rounded-3xl border border-white/5 text-center shadow-xl">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Classes</p>
          <p className="text-4xl font-black text-white">{totalConducted}</p>
        </div>
        <div className="glass-panel p-6 rounded-3xl border border-white/5 text-center shadow-xl">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Attended</p>
          <p className="text-4xl font-black text-green-500">{totalAttended}</p>
        </div>
        <div className="glass-panel p-6 rounded-3xl border border-white/5 text-center shadow-xl">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Aggregate %</p>
          <p className="text-4xl font-black text-blue-500">{totalConducted ? Math.round((totalAttended / totalConducted) * 100) : 0}%</p>
        </div>
      </div>
      
      <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900/50 text-slate-500 font-black uppercase tracking-widest">
            <tr><th className="p-4">Period</th><th className="p-4">Subject</th><th className="p-4">Conducted</th><th className="p-4">Attended</th><th className="p-4">Batch %</th></tr>
          </thead>
          <tbody>
            {filteredAttendance.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-slate-500 font-bold italic uppercase tracking-widest">No matching records found.</td></tr>
            ) : (
              filteredAttendance.map(r => (
                <tr key={r.id} className="border-b border-white/5 text-slate-300">
                  <td className="p-4">{r.dateRange}</td><td className="p-4">{r.subject}</td><td className="p-4">{r.classesConducted}</td><td className="p-4">{r.classesAttended}</td>
                  <td className={`p-4 font-black ${ (r.classesAttended/r.classesConducted) >= 0.75 ? 'text-green-500' : 'text-red-500' }`}>
                    {Math.round((r.classesAttended / r.classesConducted) * 100)}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const MarksManager: React.FC<ManagerProps> = ({ 
  userType, userEmail, authToken, search, marks, setMarks, exportToExcel 
}) => {
  const [usn, setUsn] = useState('');
  const [sub, setSub] = useState(search.subject);
  const [i1, setI1] = useState('');
  const [i2, setI2] = useState('');
  const [i3, setI3] = useState('');
  const [subjectFilter, setSubjectFilter] = useState<string>('All Subjects');

  const addMark = async () => {
    if (!usn || !sub) return;
    if (!authToken) {
      alert('Session expired. Please login again.');
      return;
    }
    try {
      const created = await createMarkRecord(authToken, {
        usn,
        subject: sub,
        internal1: i1,
        internal2: i2,
        internal3: i3
      });
      setMarks(prev => [created, ...prev]);
      setUsn(''); setI1(''); setI2(''); setI3('');
    } catch (err: any) {
      alert(err?.message || 'Failed to create marks record.');
    }
  };

  if (userType === 'teacher') {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
        <div className="glass-panel p-8 rounded-[2.5rem] border border-white/5 shadow-2xl space-y-4">
          <h3 className="text-xl font-black italic text-white uppercase">Upload Internal Marks</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <input type="text" placeholder="Student USN" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white col-span-2" value={usn} onChange={e => setUsn(e.target.value)} />
            <input type="text" placeholder="Subject" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white col-span-3" value={sub} onChange={e => setSub(e.target.value)} />
            <input type="number" placeholder="I1 (max 50)" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={i1} onChange={e => setI1(e.target.value)} />
            <input type="number" placeholder="I2 (max 50)" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={i2} onChange={e => setI2(e.target.value)} />
            <input type="number" placeholder="I3 (max 50)" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={i3} onChange={e => setI3(e.target.value)} />
            <button onClick={addMark} className="bg-blue-600 text-white rounded-xl font-black text-xs uppercase col-span-2 hover:bg-blue-500 transition-colors">Commit Marks</button>
          </div>
          <div className="flex gap-3 mt-4 items-center">
            <div className="flex-1">
              <input type="file" accept=".csv" id="marksCsv" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  (async () => {
                    if (!authToken) {
                      alert('Session expired. Please login again.');
                      return;
                    }

                    const text = String(reader.result || '');
                    const lines = text.split(/\r?\n/).filter(Boolean);
                    if (lines.length === 0) return;

                    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
                    const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim()));
                    const payloads = rows.map((cols) => {
                      const obj: any = {};
                      headers.forEach((h, i) => obj[h] = cols[i] ?? '');
                      return {
                        usn: obj['usn'] || obj['student_usn'] || '',
                        subject: obj['subject'] || '',
                        internal1: obj['internal1'] || obj['i1'] || '',
                        internal2: obj['internal2'] || obj['i2'] || '',
                        internal3: obj['internal3'] || obj['i3'] || ''
                      };
                    }).filter((p) => p.usn && p.subject);

                    const createdRows: MarkRecord[] = [];
                    for (const payload of payloads) {
                      try {
                        const created = await createMarkRecord(authToken, payload);
                        createdRows.push(created);
                      } catch {
                        // Skip invalid rows and continue processing.
                      }
                    }

                    if (createdRows.length > 0) {
                      setMarks(prev => [...createdRows, ...prev]);
                    }

                    if (createdRows.length !== payloads.length) {
                      alert(`Imported ${createdRows.length}/${payloads.length} marks rows.`);
                    }
                  })();
                };
                reader.readAsText(file);
              }} />
              <label htmlFor="marksCsv" className="w-full cursor-pointer inline-flex items-center justify-center gap-3 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-slate-800 border border-slate-700 text-slate-400">Upload CSV (Marks)</label>
            </div>
            <button onClick={() => exportToExcel(marks, 'Internal_Marks')} className="text-blue-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:text-blue-300">
              <i className="fas fa-file-excel"></i> Download Excel Record
            </button>
          </div>
        </div>
        <div className="glass-panel border border-white/5 rounded-3xl overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/50 font-black text-slate-500 uppercase tracking-widest">
              <tr><th className="p-4">USN</th><th className="p-4">Subject</th><th className="p-4">I1</th><th className="p-4">I2</th><th className="p-4">I3</th></tr>
            </thead>
            <tbody>
              {marks.map(m => (
                <tr key={m.id} className="border-b border-white/5 text-slate-300">
                  <td className="p-4 font-bold">{m.usn}</td><td className="p-4">{m.subject}</td><td className="p-4">{m.internal1}</td><td className="p-4">{m.internal2}</td><td className="p-4">{m.internal3}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const myMarks = marks.filter(m => m.usn === userEmail);
  const subjects = ['All Subjects', ...Array.from(new Set(myMarks.map(m => m.subject)))];
  const filteredMarks = subjectFilter === 'All Subjects' ? myMarks : myMarks.filter(m => m.subject === subjectFilter);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <i className="fas fa-filter text-slate-500 text-xs"></i>
          <select 
            className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-black text-white uppercase outline-none focus:border-blue-500 transition-all"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
          >
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          FILTERING FOR USN: <span className="text-blue-500">{userEmail}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredMarks.length === 0 ? (
          <div className="col-span-full py-20 text-center glass-panel border border-dashed border-white/10 rounded-3xl font-bold text-slate-500 italic uppercase tracking-widest">No marks published for this selection.</div>
        ) : (
          filteredMarks.map(m => (
            <div key={m.id} className="glass-panel p-8 rounded-3xl border border-white/5 relative group shadow-2xl">
              <div className="absolute top-0 right-0 p-6 text-blue-500/10 group-hover:text-blue-500/20 transition-all"><i className="fas fa-award text-5xl"></i></div>
              <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] mb-2">{m.subject}</p>
              <h4 className="text-2xl font-black text-white italic mb-6 uppercase tracking-tighter">Internal Assessment</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-900/50 p-4 rounded-2xl border border-white/5 text-center">
                  <p className="text-[9px] font-black text-slate-500 uppercase mb-1">CIE 1</p>
                  <p className="text-xl font-black text-white">{m.internal1 || 'N/A'}</p>
                </div>
                <div className="bg-slate-900/50 p-4 rounded-2xl border border-white/5 text-center">
                  <p className="text-[9px] font-black text-slate-500 uppercase mb-1">CIE 2</p>
                  <p className="text-xl font-black text-white">{m.internal2 || 'N/A'}</p>
                </div>
                <div className="bg-slate-900/50 p-4 rounded-2xl border border-white/5 text-center">
                  <p className="text-[9px] font-black text-slate-500 uppercase mb-1">CIE 3</p>
                  <p className="text-xl font-black text-white">{m.internal3 || 'N/A'}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const SyllabusManager: React.FC<ManagerProps> = ({ 
  userType, authToken, search, setSearch, isLoading, handleSearch, results, syllabusList, setSyllabusList 
}) => {
  const [sub, setSub] = useState(search.subject);
  const [subCode, setSubCode] = useState('');
  const [content, setContent] = useState('');
  const [pdf, setPdf] = useState<{name: string, data: string, type: string} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setPdf({ name: file.name, data: base64, type: file.type });
      };
      reader.readAsDataURL(file);
    }
  };

  const save = async () => {
    if (!sub || (!content && !pdf)) return;
    if (!authToken) {
      alert('Session expired. Please login again.');
      return;
    }
    try {
      const created = await createSyllabusEntry(authToken, {
        branch: search.branch,
        semester: search.semester,
        subject: sub,
        subjectCode: subCode,
        content,
        fileName: pdf?.name,
        fileData: pdf?.data,
        fileType: pdf?.type
      });
      setSyllabusList(prev => [created, ...prev]);
      setContent('');
      setSubCode('');
      setPdf(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      alert(err?.message || 'Failed to publish syllabus.');
    }
  };

  if (userType === 'teacher') {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
        <div className="glass-panel p-8 rounded-[2.5rem] border border-white/5 shadow-2xl space-y-4">
          <h3 className="text-xl font-black italic text-white uppercase">Syllabus Master Entry</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <input type="text" placeholder="Subject Name" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={sub} onChange={e => setSub(e.target.value)} />
             <input type="text" placeholder="Subject Code (e.g. 21CS31)" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={subCode} onChange={e => setSubCode(e.target.value)} />
          </div>
          <div className="space-y-4">
            <textarea placeholder="Enter syllabus details (Markdown supported)" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white min-h-[150px] outline-none focus:border-blue-500 transition-all" value={content} onChange={e => setContent(e.target.value)} />
            
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={handlePdfUpload} />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                    pdf ? 'bg-green-600/10 text-green-500 border border-green-500/30' : 'bg-slate-800 border border-slate-700 text-slate-400'
                  }`}
                >
                  <i className={`fas ${pdf ? 'fa-check-circle' : 'fa-file-pdf'}`}></i>
                  {pdf ? `PDF Ready: ${pdf.name}` : 'Attach Syllabus PDF'}
                </button>
              </div>
              <button onClick={save} className="w-full md:w-64 bg-gradient-purple-blue py-4 rounded-xl text-white font-black text-sm uppercase tracking-widest shadow-xl">Publish Curriculum</button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {syllabusList.filter(s => s.branch === search.branch && s.semester === search.semester).map(s => (
            <div key={s.id} className="glass-panel p-6 rounded-3xl border border-white/5 group relative">
              <div className="flex justify-between items-center mb-2">
                <div className="min-w-0">
                  <h4 className="font-black text-white italic uppercase tracking-tight truncate">{s.subject}</h4>
                  <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{s.subjectCode}</p>
                </div>
                <button
                  onClick={async () => {
                    if (!authToken) {
                      alert('Session expired. Please login again.');
                      return;
                    }
                    try {
                      await deleteSyllabusEntry(authToken, s.id);
                      setSyllabusList(prev => prev.filter(x => x.id !== s.id));
                    } catch (err: any) {
                      alert(err?.message || 'Failed to delete syllabus.');
                    }
                  }}
                  className="text-red-500/50 hover:text-red-500 transition-colors ml-2"
                >
                  <i className="fas fa-trash text-xs"></i>
                </button>
              </div>
              <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed mb-4">{s.content}</p>
              {s.fileData && <div className="text-[9px] font-black text-green-500 uppercase flex items-center gap-2"><i className="fas fa-paperclip"></i> PDF Attached</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const mySyllabus = syllabusList.filter(s => s.branch === search.branch && s.semester === search.semester);
  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex-shrink-0">
        <SearchPanel search={search} setSearch={setSearch} onSearch={handleSearch} isLoading={isLoading} fields={{ buttonText: 'Fetch AI Syllabus' }} />
        {results && <ResultDisplay title={`AI Analyzed Syllabus`} summary={results.summary} links={results.links} />}
      </div>
      {mySyllabus.length > 0 && (
        <div className="space-y-8 mt-12">
          <div className="flex items-center gap-3">
             <div className="w-1 h-6 bg-blue-500 rounded-full"></div>
             <h3 className="text-2xl font-black text-white italic uppercase tracking-tighter">Teacher Curated Curriculum</h3>
          </div>
          <div className="grid grid-cols-1 gap-8">
            {mySyllabus.map(s => (
              <div key={s.id} className="glass-panel p-10 rounded-[2.5rem] border border-blue-500/20 bg-blue-600/5 relative shadow-2xl">
                <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-6">
                  <div>
                    <h4 className="text-3xl font-black text-white italic uppercase tracking-tighter">{s.subject}</h4>
                    <p className="text-sm font-black text-blue-500 uppercase tracking-[0.3em]">{s.subjectCode}</p>
                  </div>
                  {s.fileData && (
                    <button 
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = `data:${s.fileType};base64,${s.fileData}`;
                        link.download = s.fileName || `${s.subjectCode}_Syllabus.pdf`;
                        link.click();
                      }}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-blue-600/20 flex items-center gap-2"
                    >
                      <i className="fas fa-file-pdf"></i> Download Syllabus PDF
                    </button>
                  )}
                </div>
                {s.content && (
                  <div className="prose prose-invert max-w-none text-slate-300 leading-relaxed whitespace-pre-wrap font-medium text-[15px]">
                    {s.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- Login Component ---

const Login: React.FC<{ onLogin: (portalType: UserType, loginId: string, password: string) => Promise<void> }> = ({ onLogin }) => {
  const [step, setStep] = useState<'role' | 'student-usn' | 'teacher-id'>('role');
  const [usn, setUsn] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [teacherPassword, setTeacherPassword] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleStudentUsnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (usn.length < 5) {
      setError('Please enter a valid USN.');
      return;
    }
    if (!studentPassword) {
      setError('Please enter your password.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await onLogin('student', usn, studentPassword);
    } catch (err: any) {
      setError(err?.message || 'Login failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] flex items-center justify-center p-6 overflow-hidden relative">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full"></div>
      
      <div className="max-w-4xl w-full relative z-10 animate-in fade-in zoom-in duration-700">
        {step === 'role' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="flex flex-col justify-center space-y-6">
              <div className="inline-flex items-center gap-3 px-4 py-2 bg-blue-500/10 rounded-full border border-blue-500/20 self-start">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Academic Intelligence Active</span>
              </div>
              <div className="flex items-center gap-4">
                <img
                  src={MITM_LOGO_URL}
                  alt="MITM Logo"
                  className="w-14 h-14 md:w-16 md:h-16 rounded-full object-cover border border-white/10 shadow-xl shadow-blue-600/20"
                />
                <h1 className="text-6xl font-black text-white italic tracking-tighter leading-tight">
                  MITM <span className="text-blue-500">EduOs</span>
                </h1>
              </div>
              <p className="text-slate-500 text-lg font-medium leading-relaxed max-w-sm">
                An intelligence academic OS for modern education
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <button 
                onClick={() => setStep('teacher-id')}
                className="group glass-panel p-8 rounded-[2.5rem] border border-white/5 hover:border-purple-500/50 hover:bg-purple-600/10 transition-all text-left relative overflow-hidden shadow-2xl"
              >
                <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-100 transition-opacity">
                  <i className="fas fa-chalkboard-teacher text-6xl text-purple-500"></i>
                </div>
                <div className="w-14 h-14 bg-purple-600 rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-purple-600/20 group-hover:scale-110 transition-transform">
                  <i className="fas fa-user-tie text-white text-xl"></i>
                </div>
                <h3 className="text-2xl font-black text-white mb-2 italic">FACULTY PORTAL</h3>
                <p className="text-slate-500 text-sm font-bold uppercase tracking-widest">Creator Tools & HOD Access</p>
              </button>

              <button 
                onClick={() => setStep('student-usn')}
                className="group glass-panel p-8 rounded-[2.5rem] border border-white/5 hover:border-blue-500/50 hover:bg-blue-600/10 transition-all text-left relative overflow-hidden shadow-2xl"
              >
                <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-100 transition-opacity">
                  <i className="fas fa-user-graduate text-6xl text-blue-500"></i>
                </div>
                <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-purple-600/20 group-hover:scale-110 transition-transform">
                  <i className="fas fa-book-reader text-white text-xl"></i>
                </div>
                <h3 className="text-2xl font-black text-white mb-2 italic">STUDENT PORTAL</h3>
                <p className="text-slate-500 text-sm font-bold uppercase tracking-widest">Notes, Syllabus & AI Doubt Solving</p>
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-md mx-auto glass-panel p-10 rounded-[3rem] border border-white/5 shadow-2xl animate-in slide-in-from-right-8 duration-500">
            {step === 'teacher-id' ? (
              <div>
                <button 
                  onClick={() => setStep('role')}
                  className="text-slate-500 hover:text-white transition-all mb-8 flex items-center gap-2 text-xs font-black uppercase tracking-widest"
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <div className="w-16 h-16 bg-purple-600 rounded-2xl flex items-center justify-center mb-8 shadow-xl shadow-purple-600/20 mx-auto">
                  <i className="fas fa-id-badge text-white text-2xl"></i>
                </div>
                <h2 className="text-3xl font-black text-white mb-2 italic text-center uppercase tracking-tighter">Faculty Login</h2>
                <p className="text-slate-500 text-sm font-medium mb-8 text-center">Enter your Teacher ID</p>
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!teacherId) {
                    setError('Please provide teacher ID');
                    return;
                  }
                  if (!teacherPassword) {
                    setError('Please provide password');
                    return;
                  }
                  setIsSubmitting(true);
                  setError('');
                  try {
                    await onLogin('teacher', teacherId, teacherPassword);
                  } catch (err: any) {
                    setError(err?.message || 'Login failed.');
                  } finally {
                    setIsSubmitting(false);
                  }
                }} className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Teacher ID</label>
                    <input 
                      type="text" 
                      placeholder="e.g. TCH001"
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-6 py-4 text-sm text-white focus:outline-none focus:border-purple-500 transition-all placeholder:text-slate-700"
                      value={teacherId}
                      onChange={(e) => {setTeacherId(e.target.value.toUpperCase()); setError('');}}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Password</label>
                    <input
                      type="password"
                      placeholder="Enter password"
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-6 py-4 text-sm text-white focus:outline-none focus:border-purple-500 transition-all placeholder:text-slate-700"
                      value={teacherPassword}
                      onChange={(e) => { setTeacherPassword(e.target.value); setError(''); }}
                      required
                    />
                  </div>
                  {error && <p className="text-red-500 text-[10px] mt-2 font-black uppercase tracking-widest ml-1">{error}</p>}
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-gradient-purple-blue text-white rounded-2xl py-4 font-black text-sm transition-all shadow-xl shadow-purple-600/30 uppercase tracking-widest disabled:opacity-60"
                  >
                    {isSubmitting ? 'Authenticating...' : 'Authenticate Faculty'}
                  </button>
                </form>
              </div>
            ) : (
              <div>
                <button 
                  onClick={() => setStep('role')}
                  className="text-slate-500 hover:text-white transition-all mb-8 flex items-center gap-2 text-xs font-black uppercase tracking-widest"
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-8 shadow-xl shadow-blue-600/20 mx-auto">
                  <i className="fas fa-id-card text-white text-2xl"></i>
                </div>
                <h2 className="text-3xl font-black text-white mb-2 italic text-center uppercase tracking-tighter">Student Terminal</h2>
                <p className="text-slate-500 text-sm font-medium mb-8 text-center">Enter your University Seat Number (USN)</p>
                
                <form onSubmit={handleStudentUsnSubmit} className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Student USN</label>
                    <input 
                      type="text" 
                      placeholder="e.g. 1MS21CS001"
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-6 py-4 text-sm text-white focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-700"
                      value={usn}
                      onChange={(e) => {setUsn(e.target.value.toUpperCase()); setError('');}}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Password</label>
                    <input
                      type="password"
                      placeholder="Enter password"
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-6 py-4 text-sm text-white focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-700"
                      value={studentPassword}
                      onChange={(e) => { setStudentPassword(e.target.value); setError(''); }}
                      required
                    />
                  </div>
                  {error && <p className="text-red-500 text-[10px] mt-2 font-black uppercase tracking-widest ml-1">{error}</p>}
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-gradient-purple-blue text-white rounded-2xl py-4 font-black text-sm transition-all shadow-xl shadow-blue-600/30 uppercase tracking-widest disabled:opacity-60"
                  >
                    {isSubmitting ? 'Authenticating...' : 'Authenticate Terminal'}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Note Uploader Component ---

const NoteUploader: React.FC<{ authToken: string; search: SearchState; notes: NoteEntry[]; setNotes: React.Dispatch<React.SetStateAction<NoteEntry[]>> }> = ({ authToken, search, notes, setNotes }) => {
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState(search.subject || 'General');
  const [semester, setSemester] = useState(search.semester || '1st Semester');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!authToken) {
      alert('Session expired. Please login again.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const base = (reader.result as string).split(',')[1];
      if (!base) return;
      try {
        const created = await createNote(authToken, {
          title: title || `${subject} Notes`,
          subject,
          branch: search.branch,
          semester,
          scheme: search.scheme || '',
          fileName: f.name,
          fileData: base,
          fileType: f.type
        });
        setNotes(prev => [created, ...prev.filter((n) => n.id !== created.id)]);
        setTitle('');
        if (fileRef.current) fileRef.current.value = '';
      } catch (err: any) {
        alert(err?.message || 'Failed to upload note.');
      }
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
      <div>
        <label className="text-[10px] font-black uppercase text-slate-500">Title</label>
        <input className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={title} onChange={e => setTitle(e.target.value)} placeholder="Notes title (optional)" />
      </div>
      <div>
        <label className="text-[10px] font-black uppercase text-slate-500">Subject</label>
        <input className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={subject} onChange={e => setSubject(e.target.value)} />
      </div>
      <div>
        <label className="text-[10px] font-black uppercase text-slate-500">Semester</label>
        <select className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white" value={semester} onChange={e => setSemester(e.target.value)}>
          <option>1st Semester</option>
          <option>2nd Semester</option>
          <option>3rd Semester</option>
          <option>4th Semester</option>
          <option>5th Semester</option>
          <option>6th Semester</option>
          <option>7th Semester</option>
          <option>8th Semester</option>
        </select>
      </div>
      <div className="md:col-span-3 flex gap-3">
        <input ref={fileRef} type="file" accept=".pdf,.docx,.pptx" className="hidden" onChange={handleFile} />
        <button onClick={() => fileRef.current?.click()} className="bg-slate-800 border border-slate-700 px-6 py-3 rounded-xl text-white font-black">Attach File</button>
        <p className="text-[10px] text-slate-500 self-center">Uploads will be available to students filtered by branch & semester.</p>
      </div>
    </div>
  );
};

// --- Main App Component ---

const App: React.FC = () => {
  const [userType, setUserType] = useState<UserType>(null);
  const [userEmail, setUserEmail] = useState<string>(''); // Used for USN or User ID
  const [authToken, setAuthToken] = useState<string>('');
  const [activeTab, setActiveTab] = useState<AppTab>(AppTab.SYLLABUS);
  const [search, setSearch] = useState<SearchState>({
    scheme: SCHEMES[0],
    branch: BRANCHES[0],
    semester: SEMESTERS[0],
    subject: '',
    qpType: 'INTERNAL_40',
    numClasses: '40',
    difficulty: 'Medium',
    numPartA: '5',
    numPartB: '5',
    hodRules: ''
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<{ summary: string, links: ResourceLink[] } | null>(null);
  const [resultTab, setResultTab] = useState<AppTab | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Persistence State
  const [notes, setNotes] = useState<NoteEntry[]>(() => JSON.parse(localStorage.getItem('eduos_notes') || '[]'));
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [marks, setMarks] = useState<MarkRecord[]>([]);
  const [syllabusList, setSyllabusList] = useState<SyllabusEntry[]>([]);

  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('eduos_notes', JSON.stringify(notes));
  }, [notes]);

  const loadAcademicData = useCallback(async (token: string) => {
    const [attendanceRows, marksRows, syllabusRows] = await Promise.all([
      getAttendanceRecords(token),
      getMarksRecords(token),
      getSyllabusEntries(token)
    ]);
    setAttendance(attendanceRows);
    setMarks(marksRows);
    setSyllabusList(syllabusRows);
  }, []);

  const loadNotes = useCallback(async (token: string) => {
    const notesRows = await getNotes(token, {
      branch: search.branch,
      semester: search.semester,
      subject: ''
    });
    setNotes(notesRows);
  }, [search.branch, search.semester]);

  useEffect(() => {
    if (!authToken) return;
    loadNotes(authToken).catch((err: any) => {
      setError(err?.message || 'Failed to load notes.');
    });
  }, [authToken, loadNotes]);

  const handleLogin = async (portalType: UserType, loginId: string, password: string) => {
    if (!portalType) throw new Error('Choose a portal first.');
    const response = await loginWithBackend(loginId, password);
    const backendRole = response.user.role;
    const mappedType: UserType = backendRole === 'student' ? 'student' : 'teacher';

    if (portalType === 'student' && backendRole !== 'student') {
      throw new Error('This account is not a student account.');
    }
    if (portalType === 'teacher' && backendRole === 'student') {
      throw new Error('This account is not a faculty/HOD account.');
    }

    setAuthToken(response.access_token);
    setUserType(mappedType);
    setUserEmail(response.user.login_id);
    if (mappedType === 'teacher') setActiveTab(AppTab.LESSON_PLAN);
    else setActiveTab(AppTab.SYLLABUS);

    try {
      await Promise.all([
        loadAcademicData(response.access_token),
        loadNotes(response.access_token)
      ]);
    } catch (err: any) {
      setError(err?.message || 'Logged in, but failed to load academic records.');
    }
  };

  const logout = () => {
    setAuthToken('');
    setUserType(null);
    setUserEmail('');
    setNotes([]);
    setAttendance([]);
    setMarks([]);
    setSyllabusList([]);
    setResults(null);
    setResultTab(null);
    setChatMessages([]);
  };

  const handleSearch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setResults(null);
    setResultTab(null);
    try {
      if (!authToken) throw new Error('Session expired. Please login again.');
      if (activeTab === AppTab.SYLLABUS) {
        const data = await findVTUSyllabus(authToken, search);
        setResults({ summary: data.text, links: data.links });
        setResultTab(activeTab);
      } else if (activeTab === AppTab.NOTES) {
        const data = await findVTUNotes(authToken, search);
        setResults({ summary: data.text, links: data.links });
        setResultTab(activeTab);
      } else if (activeTab === AppTab.LESSON_PLAN) {
        const data = await teacherAssistantTask(authToken, 'LESSON', search);
        setResults({ summary: data.text, links: [] });
        setResultTab(activeTab);
      } else if (activeTab === AppTab.QP_GEN) {
        const data = await teacherAssistantTask(authToken, 'QP', search);
        setResults({ summary: data.text, links: [] });
        setResultTab(activeTab);
      } else if (activeTab === AppTab.QUIZ_GEN) {
        const data = await teacherAssistantTask(authToken, 'QUIZ', search);
        setResults({ summary: data.text, links: [] });
        setResultTab(activeTab);
      } else if (activeTab === AppTab.DOC_INSIGHTS) {
        if (!search.pdfBase64) throw new Error("Please upload a PDF first.");
        const data = await teacherAssistantTask(authToken, 'DOC_ANALYZE', search);
        setResults({ summary: data.text, links: [] });
        setResultTab(activeTab);
      }
    } catch (err: any) {
      setError(err.message || "Operation failed.");
    } finally {
      setIsLoading(false);
    }
  }, [authToken, search, activeTab]);

  const handleSendChatMessage = async (overrideMsg?: string) => {
    const userMsg = overrideMsg || currentInput;
    if (!userMsg.trim()) return;
    if (!authToken) {
      setError('Session expired. Please login again.');
      return;
    }
    setCurrentInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsLoading(true);
    try {
      const history = chatMessages.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
      const response = await chatWithExpert(authToken, userMsg, history, search);
      setChatMessages(prev => [...prev, { role: 'model', text: response.text || "No response." }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'model', text: "Terminal error." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const exportToExcel = (data: any[], fileName: string) => {
    if (data.length === 0) return;
    const header = Object.keys(data[0]).join(',');
    const rows = data.map(obj => Object.values(obj).join(',')).join('\n');
    const csvContent = "data:text/csv;charset=utf-8," + header + "\n" + rows;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${fileName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getPageConfig = () => {
    let title = 'Dashboard';
    let desc = 'Welcome.';
    let fields: any = {};
    switch(activeTab) {
      case AppTab.SYLLABUS: title = 'Academic Syllabus'; desc = 'AI Scraper + Teacher Curated content.'; break;
      case AppTab.NOTES: title = 'Notes Aggregator'; desc = 'Accurate repositories for VTU students.'; fields = { subject: true, buttonText: 'Fetch Resources' }; break;
      case AppTab.LESSON_PLAN: title = 'Lesson Planner'; desc = 'Build logical teaching schedules.'; fields = { subject: true, numClasses: true, buttonText: 'Generate Plan' }; break;
      case AppTab.QP_GEN: title = 'Exam Designer'; desc = 'AI Drafted VTU Standard Question Papers.'; fields = { subject: true, difficulty: true, qpType: true, uploadDoc: true, buttonText: 'Draft Paper' }; break;
      case AppTab.QUIZ_GEN: title = 'Quiz Builder'; desc = 'Instant internal MCQs.'; fields = { subject: true, uploadDoc: true, buttonText: 'Create Quiz' }; break;
      case AppTab.DOC_INSIGHTS: title = 'Doc Intelligence'; desc = 'Extract key insights from PDFs.'; fields = { subject: true, uploadDoc: true, buttonText: 'Analyze Doc' }; break;
      case AppTab.ATTENDANCE: title = userType === 'teacher' ? 'Attendance Control' : 'My Attendance'; desc = 'Track presence for 10-20 day blocks.'; break;
      case AppTab.INTERNAL_MARKS: title = userType === 'teacher' ? 'Marks Entry' : 'My Performance'; desc = 'Internal assessment tracking portal.'; break;
      case AppTab.SYLLABUS_MGMT: title = 'Syllabus Master'; desc = 'Publish curriculum via text or PDF.'; break;
      case AppTab.AI_SEARCH: title = 'Expert Terminal'; desc = 'Query engineering professor MITM AI.'; break;
      case AppTab.HOD_RULES: title = 'HOD Governance'; desc = 'Set system-wide academic constraints.'; break;
      case AppTab.NOTE_VAULT: title = 'Note Repository'; desc = 'Local verified storage hub.'; fields = { subject: true }; break;
      default: break;
    }
    fields = { ...(fields || {}), hideScheme: true };
    return { title, desc, fields };
  };

  if (!userType) return <Login onLogin={handleLogin} />;

  const config = getPageConfig();
  const managerProps: ManagerProps = {
    userType, userEmail, authToken, search, setSearch, isLoading, handleSearch, results: resultTab === activeTab ? results : null,
    attendance, setAttendance, marks, setMarks, syllabusList, setSyllabusList, exportToExcel
  };

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab} userType={userType} logout={logout}>
      <div className="animate-in fade-in slide-in-from-top-4 duration-700 space-y-8 h-full flex flex-col pb-20 overflow-y-auto pr-2">
        <div className="flex-shrink-0">
          <div className="flex items-center gap-3 mb-2">
             <div className="h-0.5 w-12 bg-blue-500 rounded-full"></div>
             <span className="text-[10px] font-black text-blue-500 uppercase tracking-[0.3em]">Module Online</span>
          </div>
          <h1 className="text-5xl font-black mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-400 to-purple-500 italic uppercase tracking-tighter">
            {config.title}
          </h1>
          <p className="text-slate-500 font-bold uppercase text-[11px] tracking-widest">{config.desc}</p>
        </div>

        {activeTab === AppTab.ATTENDANCE ? <AttendanceManager {...managerProps} /> :
         activeTab === AppTab.INTERNAL_MARKS ? <MarksManager {...managerProps} /> :
         activeTab === AppTab.SYLLABUS_MGMT || activeTab === AppTab.SYLLABUS ? <SyllabusManager {...managerProps} /> :
         activeTab === AppTab.NOTE_VAULT ? (
           <div className="flex flex-col gap-8">
             <SearchPanel search={search} setSearch={setSearch} onSearch={() => {}} isLoading={false} fields={config.fields} />
             {userType === 'teacher' && (
               <div className="glass-panel p-6 rounded-3xl border border-white/5">
                 <NoteUploader authToken={authToken} search={search} setNotes={setNotes} notes={notes} />
               </div>
             )}
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {notes.filter(n => n.branch === search.branch && n.semester === search.semester).map(n => (
                  <div key={n.id} className="glass-panel p-6 rounded-3xl border border-white/5 group shadow-xl relative overflow-hidden transition-all hover:border-blue-500/50">
                    <div className="absolute top-0 right-0 p-4 text-blue-500/10 group-hover:text-blue-500/20 transition-all"><i className="fas fa-file-pdf text-4xl"></i></div>
                    <div className="mb-4">
                      <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[9px] font-black rounded uppercase border border-blue-500/20">{n.subject}</span>
                      <h4 className="text-lg font-black text-white italic mt-2 uppercase tracking-tight line-clamp-1">{n.title}</h4>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => {
                        const link = document.createElement('a');
                        link.href = `data:${n.fileType};base64,${n.fileData}`;
                        link.download = n.fileName;
                        link.click();
                      }} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-2.5 font-black text-[10px] transition-all uppercase tracking-widest">DOWNLOAD</button>
                      {userType === 'teacher' && <button onClick={() => {
                        (async () => {
                          if (!authToken) {
                            alert('Session expired. Please login again.');
                            return;
                          }
                          try {
                            await deleteNote(authToken, n.id);
                            setNotes(prev => prev.filter(x => x.id !== n.id));
                          } catch (err: any) {
                            alert(err?.message || 'Failed to delete note.');
                          }
                        })();
                      }} className="w-10 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all"><i className="fas fa-trash"></i></button>}
                    </div>
                  </div>
                ))}
             </div>
           </div>
         ) : activeTab === AppTab.AI_SEARCH ? (
           <div className="flex-1 flex flex-col glass-panel rounded-[2.5rem] border border-white/5 min-h-[600px] shadow-2xl bg-slate-900/40 relative overflow-hidden">
             <div className="p-6 border-b border-white/5 flex items-center justify-between bg-slate-950/20">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-purple-blue flex items-center justify-center shadow-lg"><i className="fas fa-microchip text-white"></i></div>
                  <div><h3 className="text-base font-black text-white italic tracking-tight uppercase">MITM AI Expert</h3><p className="text-[9px] text-blue-500 font-black tracking-widest uppercase">Academic Terminal</p></div>
                </div>
                <button onClick={() => setChatMessages([])} className="text-[10px] font-black text-slate-500 uppercase tracking-widest border border-slate-800 px-4 py-2 rounded-xl hover:text-white hover:border-slate-700 transition-all">Reset Logs</button>
             </div>
             <div className="flex-1 overflow-y-auto p-8 space-y-6">
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-6 rounded-3xl shadow-xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-900 text-slate-300 border border-white/5 rounded-tl-none'}`}>{m.text}</div>
                  </div>
                ))}
                {isLoading && <div className="text-xs font-bold italic text-slate-500">Processing Neural Link...</div>}
                <div ref={chatEndRef} />
             </div>
             <div className="p-6 bg-slate-950/30 border-t border-white/5">
                <div className="relative flex items-center gap-4 max-w-4xl mx-auto w-full">
                  <input type="text" placeholder="Ask a technical academic question..." className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl px-6 py-4 pr-16 text-sm text-white outline-none focus:border-blue-500 transition-all" value={currentInput} onChange={e => setCurrentInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendChatMessage()} />
                  <button onClick={() => handleSendChatMessage()} disabled={isLoading || !currentInput.trim()} className="absolute right-3 p-3 bg-gradient-purple-blue text-white rounded-xl shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 transition-all"><i className="fas fa-paper-plane"></i></button>
                </div>
             </div>
           </div>
         ) : (
           <div className="flex-shrink-0">
             <SearchPanel search={search} setSearch={setSearch} onSearch={handleSearch} isLoading={isLoading} fields={config.fields} />
             {error && <div className="p-6 bg-red-950/30 border border-red-500/30 rounded-3xl text-red-400 mb-8 font-bold text-sm">{error}</div>}
             {results && resultTab === activeTab && (
               <ResultDisplay
                 title={`${search.subject || 'MITM EduOs'} Analysis`}
                 summary={results.summary}
                 links={results.links}
                 isEditable={activeTab === AppTab.QP_GEN || activeTab === AppTab.QUIZ_GEN}
                 downloadFileBaseName={
                   activeTab === AppTab.QP_GEN
                     ? `${search.subject || 'mitm-eduos'}-${search.qpType === 'INTERNAL_40' ? 'internal-40' : 'final-100'}-question-paper`
                     : activeTab === AppTab.QUIZ_GEN
                     ? `${search.subject || 'mitm-eduos'}-quiz`
                     : undefined
                 }
               />
             )}
           </div>
         )}
      </div>
    </Layout>
  );
};

export default App;
