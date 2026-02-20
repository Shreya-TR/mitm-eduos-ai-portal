
import React from 'react';
import { AppTab, UserType } from '../types';

const MITM_LOGO_URL = 'https://notopedia-uploads.s3.us-east-2.amazonaws.com/clg-logo/logo-202007311306041945.png';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  userType: UserType;
  logout: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, activeTab, setActiveTab, userType, logout }) => {
  const teacherTabs = [
    { id: AppTab.LESSON_PLAN, icon: 'fa-calendar-alt', label: 'Lesson Planner' },
    { id: AppTab.SYLLABUS_MGMT, icon: 'fa-book-medical', label: 'Syllabus Creator' },
    { id: AppTab.ATTENDANCE, icon: 'fa-clipboard-user', label: 'Attendance' },
    { id: AppTab.INTERNAL_MARKS, icon: 'fa-award', label: 'Internal Marks' },
    { id: AppTab.QP_GEN, icon: 'fa-file-signature', label: 'Exam Designer' },
    { id: AppTab.QUIZ_GEN, icon: 'fa-list-check', label: 'Quiz Builder' },
    { id: AppTab.HOD_RULES, icon: 'fa-shield-halved', label: 'HOD Board' },
    { id: AppTab.NOTE_VAULT, icon: 'fa-vault', label: 'Note Vault' },
  ];

  const studentTabs = [
    { id: AppTab.SYLLABUS, icon: 'fa-scroll', label: 'My Syllabus' },
    { id: AppTab.ATTENDANCE, icon: 'fa-user-check', label: 'My Attendance' },
    { id: AppTab.INTERNAL_MARKS, icon: 'fa-chart-bar', label: 'My Marks' },
    { id: AppTab.NOTES, icon: 'fa-book-open', label: 'Notes Hub' },
    { id: AppTab.DOC_INSIGHTS, icon: 'fa-brain', label: 'Doc Intelligence' },
    { id: AppTab.AI_SEARCH, icon: 'fa-terminal', label: 'Expert Chat' },
    { id: AppTab.NOTE_VAULT, icon: 'fa-vault', label: 'Resource Vault' },
  ];

  const tabs = userType === 'teacher' ? teacherTabs : studentTabs;

  return (
    <div className="flex h-screen bg-[#020617] text-slate-300 overflow-hidden">
      {/* Sidebar - Fixed */}
      <aside className="w-72 bg-[#020617] border-r border-white/5 flex flex-col flex-shrink-0 h-full z-40 overflow-y-auto">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-12">
            <img
              src={MITM_LOGO_URL}
              alt="MITM Logo"
              className="w-10 h-10 rounded-full object-cover border border-white/10 shadow-lg shadow-blue-600/20"
            />
            <h1 className="text-2xl font-black text-white italic tracking-tighter">MITM <span className="text-blue-500 uppercase">EduOs</span></h1>
          </div>

          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-4 px-5 py-3 rounded-2xl transition-all font-bold text-sm tracking-tight ${
                  activeTab === tab.id 
                    ? 'bg-blue-600 text-white shadow-xl shadow-blue-600/20' 
                    : 'hover:bg-slate-900/50 hover:text-white'
                }`}
              >
                <i className={`fas ${tab.icon} w-5 ${activeTab === tab.id ? 'text-white' : 'text-slate-500'}`}></i>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-8 border-t border-white/5 bg-[#020617]">
          <div className="bg-slate-900/30 rounded-2xl p-4 border border-white/5 mb-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Session</p>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
                <i className={`fas ${userType === 'teacher' ? 'fa-user-tie' : 'fa-graduation-cap'} text-xs text-blue-400`}></i>
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-black text-white truncate">{userType === 'teacher' ? 'Faculty Admin' : 'Student Pro'}</p>
                <p className="text-[10px] text-slate-500">VTU Authenticated</p>
              </div>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center gap-3 px-5 py-3 rounded-2xl text-red-500 hover:bg-red-500/10 transition-all font-black text-xs uppercase tracking-widest"
          >
            <i className="fas fa-sign-out-alt"></i>
            Terminate
          </button>
        </div>
      </aside>

      {/* Main Content - Scrollable */}
      <main className="flex-1 h-full overflow-y-auto p-12 custom-scrollbar">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
