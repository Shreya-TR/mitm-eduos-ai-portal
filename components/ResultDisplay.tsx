
import React, { useEffect, useMemo, useState } from 'react';
import { ResourceLink } from '../types';

interface ResultDisplayProps {
  title: string;
  summary: string;
  links: ResourceLink[];
  isEditable?: boolean;
  downloadFileBaseName?: string;
}

const sanitizeFileName = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'generated-content';

const toPdfAscii = (text: string) =>
  text
    .replace(/\r/g, '')
    .replace(/[^\x20-\x7E\n]/g, '?');

const escapePdfText = (line: string) =>
  line
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

const wrapText = (text: string, maxCharsPerLine = 95) => {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxCharsPerLine) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
};

const buildSimplePdf = (text: string) => {
  const safeText = toPdfAscii(text);
  const allLines = wrapText(safeText, 95);
  const maxLinesPerPage = 52;
  const pages: string[][] = [];
  for (let i = 0; i < allLines.length; i += maxLinesPerPage) {
    pages.push(allLines.slice(i, i + maxLinesPerPage));
  }
  if (pages.length === 0) pages.push(['']);

  const totalObjects = 3 + pages.length * 2;
  const objects: string[] = [];

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;

  const pageRefs: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const pageObjectNumber = 4 + i * 2;
    pageRefs.push(`${pageObjectNumber} 0 R`);
  }
  objects[2] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  for (let i = 0; i < pages.length; i++) {
    const pageObjectNumber = 4 + i * 2;
    const contentObjectNumber = 5 + i * 2;
    const pageLines = pages[i];

    const streamLines = [
      'BT',
      '/F1 11 Tf',
      '14 TL',
      '50 800 Td',
      ...pageLines.map((line, index) => `${index === 0 ? '' : 'T* '}(${escapePdfText(line)}) Tj`.trim()),
      'ET'
    ];
    const streamContent = streamLines.join('\n');
    objects[contentObjectNumber] = `<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`;
    objects[pageObjectNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i <= totalObjects; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${totalObjects + 1}\n`;
  pdf += `0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjects; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new Blob([pdf], { type: 'application/pdf' });
};

const ResultDisplay: React.FC<ResultDisplayProps> = ({
  title,
  summary,
  links,
  isEditable = false,
  downloadFileBaseName
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editableSummary, setEditableSummary] = useState(summary);

  useEffect(() => {
    setEditableSummary(summary);
    setIsEditing(false);
  }, [summary]);

  const fileBaseName = useMemo(
    () => sanitizeFileName(downloadFileBaseName || title),
    [downloadFileBaseName, title]
  );

  const handleDownloadPdf = () => {
    const blob = buildSimplePdf(editableSummary);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileBaseName}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 space-y-8">
      <div className="glass-panel p-10 rounded-[2.5rem] border border-white/5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none">
          <i className="fas fa-brain text-9xl"></i>
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="h-6 w-1 bg-blue-500 rounded-full"></div>
            <h2 className="text-xl font-black text-white italic tracking-tight uppercase">{title}</h2>
          </div>
          {isEditable && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setIsEditing(prev => !prev)}
                className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:border-blue-500 transition-all"
              >
                <i className={`fas ${isEditing ? 'fa-eye' : 'fa-pen'} mr-2`}></i>
                {isEditing ? 'Preview' : 'Edit'}
              </button>
              <button
                onClick={handleDownloadPdf}
                className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-blue-600/15 border border-blue-500/30 text-blue-300 hover:bg-blue-600/25 transition-all"
              >
                <i className="fas fa-download mr-2"></i>
                Download PDF
              </button>
            </div>
          )}
        </div>

        <div className="prose prose-invert max-w-none prose-slate">
          {isEditable && isEditing ? (
            <textarea
              value={editableSummary}
              onChange={(e) => setEditableSummary(e.target.value)}
              className="w-full min-h-[420px] bg-slate-950/70 border border-blue-500/20 rounded-2xl p-5 text-slate-200 leading-relaxed font-medium text-[14px] outline-none focus:border-blue-500 resize-y"
            />
          ) : (
            <div className="text-slate-300 leading-relaxed whitespace-pre-wrap font-medium text-[15px]">
              {isEditable ? editableSummary : summary}
            </div>
          )}
        </div>
      </div>

      {links.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest ml-4">Verified Resource Anchors</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {links.map((link, i) => {
              const isPdfSource = link.url.includes('vtucode') || link.url.includes('vtu-circle') || link.url.includes('notes') || link.url.includes('azdocuments');
              return (
                <a 
                  key={i} 
                  href={link.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className={`group glass-panel p-5 rounded-2xl border transition-all flex items-center justify-between ${
                    isPdfSource ? 'border-blue-500/50 bg-blue-600/10 shadow-lg shadow-blue-500/10' : 'border-white/5 hover:border-blue-500/50 hover:bg-blue-600/5'
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 ${
                      isPdfSource ? 'bg-blue-600 text-white' : 'bg-slate-900 border border-slate-800 text-blue-400'
                    }`}>
                      <i className={`fas ${isPdfSource ? 'fa-file-pdf' : 'fa-link'} text-xs`}></i>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black text-white italic tracking-tight mb-0.5 truncate pr-2">{link.title}</p>
                      <p className={`text-[9px] font-bold uppercase tracking-widest ${isPdfSource ? 'text-blue-300' : 'text-slate-500'}`}>
                        {isPdfSource ? 'DIRECT PDF SOURCE' : 'RESOURCE LINK'}
                      </p>
                    </div>
                  </div>
                  <i className="fas fa-external-link-alt text-[10px] text-slate-700 group-hover:text-blue-500 transition-colors flex-shrink-0"></i>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultDisplay;
