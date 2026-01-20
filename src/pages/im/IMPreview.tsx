import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getIMTemplateById, getIMSections } from '../../services/apiService';
import { IMTemplate, IMSection } from '../../types';
import { BookOpen, Globe, LayoutTemplate } from 'lucide-react';

const ALL_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ru', label: 'Russian' }
];

const IMPreview: React.FC = () => {
  const { templateId } = useParams<{ templateId: string }>();
  const [template, setTemplate] = useState<IMTemplate | null>(null);
  const [sections, setSections] = useState<IMSection[]>([]);
  const [activeLang, setActiveLang] = useState('en');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!templateId) {
      setError('Invalid link.');
      setLoading(false);
      return;
    }
    loadData();
  }, [templateId]);

  const loadData = async () => {
    if (!templateId) return;
    try {
      const temp = await getIMTemplateById(templateId);
      if (!temp) {
        setError('Template not found.');
      } else {
        setTemplate(temp);
        const secs = await getIMSections(temp.id);
        setSections(secs);
      }
    } catch (e) {
      setError('Failed to load template.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">Loading Preview...</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-red-500 font-medium">{error}</div>;
  if (!template) return null;

  // Filter available languages based on what's enabled in the template
  const enabledLanguages = ALL_LANGUAGES.filter(l => template.languages?.includes(l.code));
  
  const rootSections = sections.filter(s => !s.parentId).sort((a, b) => a.order - b.order);
  const primaryColor = template.metadata?.primaryColor || '#0f172a';

  const renderSection = (s: IMSection, indexPrefix: string, level: number) => {
     const children = sections.filter(sec => sec.parentId === s.id).sort((a, b) => a.order - b.order);
     const isSub = level > 0;
     
     const content = s.content[activeLang];

     return (
        <div key={s.id} className={isSub ? 'mt-6 ml-8' : 'mt-10'}>
            <div className="flex items-baseline gap-3 mb-3">
               <span className={`${isSub ? 'text-slate-400 text-lg' : 'text-slate-300 text-xl'} font-bold`}>{indexPrefix}</span>
               <h3 className={`${isSub ? 'text-lg text-slate-700' : 'text-xl text-slate-800'} font-bold`}>{s.title}</h3>
            </div>
            
            {s.isPlaceholder ? (
               <div className="bg-slate-50 border border-dashed border-slate-300 rounded-lg p-6 flex flex-col items-center justify-center text-center text-slate-400">
                  <LayoutTemplate size={32} className="mb-2 opacity-30" />
                  <p className="text-sm italic font-medium">Placeholder Section</p>
                  <p className="text-xs mt-1">Content for this section is project-specific and will be added during production.</p>
               </div>
            ) : (
               <div className="text-slate-700 leading-relaxed pl-8 font-sans im-content">
                  {content ? (
                     <div dangerouslySetInnerHTML={{ __html: content }} />
                  ) : (
                     <span className="text-slate-400 italic">No content available for this language.</span>
                  )}
               </div>
            )}
            
            {children.map((child, idx) => renderSection(child, `${indexPrefix}${idx + 1}.`, level + 1))}
        </div>
     );
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20 font-sans">
      {/* Add custom styles for standard HTML elements inside content */}
      <style>{`
         .im-content ul { 
           list-style-type: disc !important; 
           padding-left: 1.5em !important; 
           margin-bottom: 1em !important; 
           display: block !important;
         }
         .im-content ol { 
           list-style-type: decimal !important; 
           padding-left: 1.5em !important; 
           margin-bottom: 1em !important; 
           display: block !important;
         }
         .im-content li { 
           display: list-item !important; 
           margin-bottom: 0.25em !important; 
         }
         .im-content p { 
           margin-bottom: 1em !important; 
           display: block !important;
         }
         .im-content b, .im-content strong { font-weight: bold !important; }
         .im-content i, .im-content em { font-style: italic !important; }
         .im-content u { text-decoration: underline !important; }

         /* Block Styles */
        .im-block-wrapper {
            display: flex;
            align-items: flex-start;
            gap: 1.5rem;
            padding: 1.5rem;
            margin: 1.5rem 0;
            border-radius: 6px;
            border-left: 6px solid;
            background-color: #fff;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .im-block-icon {
            flex-shrink: 0;
            width: 64px;
            height: 64px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .im-block-content {
            flex: 1;
            min-width: 0;
        }
        .im-block-title {
            display: block;
            font-weight: 800;
            text-transform: uppercase;
            font-size: 0.9rem;
            margin-bottom: 0.5rem;
            letter-spacing: 0.05em;
        }

        .im-block-warning { background-color: #fff7ed; border-left-color: #f97316; }
        .im-block-warning .im-block-title { color: #c2410c; }

        .im-block-caution { background-color: #fefce8; border-left-color: #eab308; }
        .im-block-caution .im-block-title { color: #854d0e; }

        .im-block-electric { background-color: #fef2f2; border-left-color: #dc2626; }
        .im-block-electric .im-block-title { color: #b91c1c; }

        .im-block-info { background-color: #eff6ff; border-left-color: #3b82f6; }
        .im-block-info .im-block-title { color: #1d4ed8; }

        .im-table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
        .im-table th, .im-table td { border: 1px solid #cbd5e1; padding: 0.5rem; }
        .im-table th { background-color: #f1f5f9; font-weight: bold; text-align: left; }
      `}</style>

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg text-white shadow-sm">
              <BookOpen size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">{template.name}</h1>
              <p className="text-xs text-slate-500">Instruction Manual Preview</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
             <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded border border-slate-200">
                <Globe size={14} className="text-slate-400" />
                <select 
                  className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer"
                  value={activeLang}
                  onChange={(e) => setActiveLang(e.target.value)}
                >
                   {enabledLanguages.map(l => (
                     <option key={l.code} value={l.code}>{l.label}</option>
                   ))}
                </select>
             </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white shadow-lg rounded-xl border border-slate-200 min-h-[800px] relative overflow-hidden">
           {/* COVER PAGE */}
           <div className="min-h-[800px] flex flex-col relative bg-white border-b border-slate-100">
             {template.metadata?.coverImageUrl && (
                <div className="h-[400px] bg-cover bg-center" style={{ backgroundImage: `url(${template.metadata.coverImageUrl})` }} />
             )}
             <div className="flex-1 p-12 flex flex-col justify-between">
                <div>
                   {template.metadata?.companyLogoUrl && (
                      <img src={template.metadata.companyLogoUrl} alt="Logo" className="h-16 object-contain mb-10" />
                   )}
                   <h1 className="text-5xl font-bold text-slate-900 mb-4">Product Name</h1>
                   <p className="text-xl text-slate-500 uppercase tracking-widest font-light">Instruction Manual</p>
                </div>
                <div className="border-t-4 pt-6" style={{ borderColor: primaryColor }}>
                   <p className="text-lg font-bold text-slate-900 uppercase mb-1">{template.metadata?.companyName || 'Company Name'}</p>
                   <p className="text-sm text-slate-500">Original Instructions</p>
                </div>
             </div>
           </div>

           {/* CONTENT PAGES */}
           <div className="p-12 pb-24 min-h-[800px]">
               {rootSections.map((section, index) => renderSection(section, `${index + 1}.`, 0))}
           </div>

           {/* FOOTER */}
           {template.metadata?.footerText && (
              <div className="absolute bottom-0 left-0 right-0 p-6 border-t border-slate-100 text-center text-xs text-slate-400">
                 {template.metadata.footerText}
              </div>
           )}

           {/* BACK PAGE */}
           {template.metadata?.backPageContent && (
             <div className="min-h-[800px] bg-slate-50 p-12 flex flex-col justify-end mt-4 border-t border-slate-200">
                <div className="border-t pt-8" style={{ borderColor: primaryColor }}>
                    <div dangerouslySetInnerHTML={{ __html: template.metadata.backPageContent }} />
                    <div className="mt-10 text-xs text-slate-400 text-center">
                       &copy; {new Date().getFullYear()} {template.metadata.companyName || 'Company Name'}. All rights reserved.
                    </div>
                </div>
             </div>
           )}
        </div>
      </main>
    </div>
  );
};

export default IMPreview;