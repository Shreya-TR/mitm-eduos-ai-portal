
import React, { useRef } from 'react';
import { SearchState } from '../types';
import { SCHEMES, BRANCHES, SEMESTERS } from '../constants';

interface SearchPanelProps {
  search: SearchState;
  setSearch: React.Dispatch<React.SetStateAction<SearchState>>;
  onSearch: () => void;
  isLoading: boolean;
  fields: {
    subject?: boolean;
    numClasses?: boolean;
    difficulty?: boolean;
    qpType?: boolean;
    uploadDoc?: boolean;
    hideScheme?: boolean;
    qpCounts?: boolean;
    buttonText?: string;
  };
}

const SearchPanel: React.FC<SearchPanelProps> = ({ search, setSearch, onSearch, isLoading, fields }) => {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setSearch(prev => ({ ...prev, pdfBase64: base64 }));
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="glass-panel p-8 rounded-[2.5rem] border border-white/5 shadow-2xl mb-10 space-y-6 relative overflow-hidden group">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600"></div>
      
      <div className={`grid grid-cols-1 ${fields.hideScheme ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-6`}>
        {!fields.hideScheme && (
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1">Academic Scheme</label>
            <select 
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none transition-all appearance-none cursor-pointer"
              value={search.scheme}
              onChange={(e) => setSearch({...search, scheme: e.target.value})}
            >
              {SCHEMES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1">Engineering Branch</label>
          <select 
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none transition-all appearance-none cursor-pointer"
            value={search.branch}
            onChange={(e) => setSearch({...search, branch: e.target.value})}
          >
            {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1">Semester</label>
          <select 
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none transition-all appearance-none cursor-pointer"
            value={search.semester}
            onChange={(e) => setSearch({...search, semester: e.target.value})}
          >
            {SEMESTERS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {fields.subject && (
          <div className="lg:col-span-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1 block mb-2">Subject Title</label>
            <input 
              type="text"
              placeholder="e.g. Discrete Mathematics"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-5 py-3.5 text-sm focus:border-blue-500 outline-none transition-all"
              value={search.subject}
              onChange={(e) => setSearch({...search, subject: e.target.value})}
            />
          </div>
        )}
        {fields.numClasses && (
          <div>
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1 block mb-2">Total Classes</label>
            <input 
              type="number"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-5 py-3.5 text-sm focus:border-blue-500 outline-none transition-all"
              value={search.numClasses}
              onChange={(e) => setSearch({...search, numClasses: e.target.value})}
            />
          </div>
        )}
        {fields.difficulty && (
          <div>
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1 block mb-2">Difficulty Scale</label>
            <select 
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-5 py-3.5 text-sm focus:border-blue-500 outline-none transition-all appearance-none cursor-pointer"
              value={search.difficulty}
              onChange={(e) => setSearch({...search, difficulty: e.target.value})}
            >
              <option value="Easy">Standard</option>
              <option value="Medium">Rigorous</option>
              <option value="Hard">Advanced</option>
            </select>
          </div>
        )}
        {fields.qpType && (
          <div>
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1 block mb-2">Question Paper Type</label>
            <select
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-5 py-3.5 text-sm focus:border-blue-500 outline-none transition-all appearance-none cursor-pointer"
              value={search.qpType}
              onChange={(e) => setSearch({ ...search, qpType: e.target.value as SearchState['qpType'] })}
            >
              <option value="INTERNAL_40">Internal QP (40 Marks)</option>
              <option value="FINAL_100">Final Exam QP (100 Marks)</option>
            </select>
          </div>
        )}
      </div>

      {fields.qpCounts && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-300">
           <div>
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500 ml-1 block mb-2">Part A Questions (Short)</label>
            <input 
              type="number"
              className="w-full bg-slate-900 border border-blue-900/30 rounded-xl px-5 py-3.5 text-sm focus:border-blue-500 outline-none transition-all"
              value={search.numPartA}
              onChange={(e) => setSearch({...search, numPartA: e.target.value})}
            />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-500 ml-1 block mb-2">Part B Questions (Long/Numerical)</label>
            <input 
              type="number"
              className="w-full bg-slate-900 border border-purple-900/30 rounded-xl px-5 py-3.5 text-sm focus:border-blue-500 outline-none transition-all"
              value={search.numPartB}
              onChange={(e) => setSearch({...search, numPartB: e.target.value})}
            />
          </div>
        </div>
      )}

      {(fields.uploadDoc || fields.buttonText) && (
        <div className="flex flex-col md:flex-row gap-4 pt-4 border-t border-white/5 items-center">
          {fields.uploadDoc && (
            <div className="flex-1 w-full">
              <input 
                type="file"
                ref={fileRef}
                className="hidden"
                accept=".pdf"
                onChange={handleFileChange}
              />
              <button 
                onClick={() => fileRef.current?.click()}
                className={`w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
                  search.pdfBase64 ? 'bg-green-600/10 text-green-500 border border-green-500/30' : 'bg-slate-800/50 hover:bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                <i className={`fas ${search.pdfBase64 ? 'fa-check-circle' : 'fa-file-pdf'}`}></i>
                {search.pdfBase64 ? 'Reference Document Active' : 'Inject Context (PDF)'}
              </button>
            </div>
          )}
          {fields.buttonText && (
            <button 
              onClick={onSearch}
              disabled={isLoading}
              className="w-full md:w-64 bg-gradient-purple-blue hover:scale-[1.02] active:scale-[0.98] text-white rounded-2xl px-8 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-blue-600/30 disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {isLoading ? (
                 <>
                   <i className="fas fa-spinner fa-spin"></i>
                   Syncing...
                 </>
              ) : (
                <>
                  <i className="fas fa-microchip"></i>
                  {fields.buttonText || 'Execute'}
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchPanel;
