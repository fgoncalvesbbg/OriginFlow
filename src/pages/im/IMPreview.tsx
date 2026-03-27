import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getIMTemplateById, getIMSections } from '../../services';
import { IMTemplate, IMSection, IMMasterLayoutName, IMMasterPageOverride } from '../../types';
import { BookOpen, Globe, LayoutTemplate } from 'lucide-react';
import './styles/im-content.css';
import { getIMThemeVariables } from './styles/im-theme';

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


const DEFAULT_MASTER_PAGES: Record<IMMasterLayoutName, IMMasterPageOverride> = {
  cover: {},
  chapter: {},
  body: {},
  appendix: {},
  end: {}
};

const resolveSectionLayout = (section: IMSection, sectionLayoutMap?: Record<string, IMMasterLayoutName>): IMMasterLayoutName => {
  if (!sectionLayoutMap) return 'body';
  return (
    sectionLayoutMap[section.id] ||
    sectionLayoutMap[section.parentId ? 'type:subsection' : 'type:section'] ||
    sectionLayoutMap[section.isPlaceholder ? 'type:placeholder' : 'type:content'] ||
    sectionLayoutMap.default ||
    'body'
  );
};

const getBackgroundStyle = (override?: IMMasterPageOverride) => {
  const bg = override?.background?.trim();
  if (!bg) return undefined;
  if (bg.startsWith('http') || bg.startsWith('data:image') || bg.includes('gradient')) {
    return { backgroundImage: bg.startsWith('gradient') ? bg : `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return { backgroundColor: bg };
};

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

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-light text-muted">Loading Preview...</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center bg-light text-red-500 font-medium">{error}</div>;
  if (!template) return null;

  // Filter available languages based on what's enabled in the template
  const enabledLanguages = ALL_LANGUAGES.filter(l => template.languages?.includes(l.code));
  
  const rootSections = sections.filter(s => !s.parentId).sort((a, b) => a.order - b.order);
  const imThemeVars = getIMThemeVariables(template.metadata);
  const masterPages = {
    ...DEFAULT_MASTER_PAGES,
    ...(template.metadata?.masterPages || {})
  };

  const renderSection = (s: IMSection, indexPrefix: string, level: number) => {
     const children = sections.filter(sec => sec.parentId === s.id).sort((a, b) => a.order - b.order);
     const isSub = level > 0;
     const content = s.content[activeLang];
     const layout = resolveSectionLayout(s, template.metadata?.sectionLayoutMap);
     const layoutOverride = masterPages[layout];

     return (
        <div key={s.id} className={isSub ? 'mt-6 ml-8' : 'mt-10'} style={getBackgroundStyle(layoutOverride)}>
            <div className="flex items-baseline gap-3 mb-3">
               <span className={`${isSub ? 'text-gray-400 text-lg' : 'text-gray-300 text-xl'} font-bold`}>{indexPrefix}</span>
               <h3 className={`${isSub ? 'text-lg text-gray-700' : 'text-xl text-gray-800'} font-bold`}>{s.title}</h3>
               <span className="text-[10px] uppercase tracking-wide text-gray-400">{layout}</span>
            </div>

            {layoutOverride?.iconStrip && <div className="text-xs text-gray-500 mb-3">{layoutOverride.iconStrip}</div>}
            
            {s.isPlaceholder ? (
               <div className="bg-light border border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center text-center text-gray-400">
                  <LayoutTemplate size={32} className="mb-2 opacity-30" />
                  <p className="text-sm italic font-medium">Placeholder Section</p>
                  <p className="text-xs mt-1">Content for this section is project-specific and will be added during production.</p>
               </div>
            ) : (
               <div className="text-gray-700 leading-relaxed pl-8 font-sans im-content">
                  {content ? (
                     <div dangerouslySetInnerHTML={{ __html: content }} />
                  ) : (
                     <span className="text-gray-400 italic">No content available for this language.</span>
                  )}
               </div>
            )}
            
            {children.map((child, idx) => renderSection(child, `${indexPrefix}${idx + 1}.`, level + 1))}
        </div>
     );
  };

  return (
    <div className="min-h-screen bg-light pb-20 font-sans" style={imThemeVars}>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow">
        <div className="max-w-4xl mx-auto px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl text-white shadow">
              <BookOpen size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-primary leading-tight">{template.name}</h1>
              <p className="text-xs text-muted">Instruction Manual Preview</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
             <div className="flex items-center gap-2 bg-light px-3 py-1.5 rounded border border-gray-200">
                <Globe size={14} className="text-gray-400" />
                <select 
                  className="bg-transparent text-sm font-medium text-gray-700 outline-none cursor-pointer"
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
        <div className="bg-white shadow-lg rounded-xl border border-gray-200 min-h-[800px] relative overflow-hidden">
           {/* COVER PAGE */}
           <div className="min-h-[800px] flex flex-col relative bg-white border-b border-gray-100" style={getBackgroundStyle(masterPages.cover)}>
             {template.metadata?.coverImageUrl && (
                <div className="h-[400px] bg-cover bg-center" style={{ backgroundImage: `url(${template.metadata.coverImageUrl})` }} />
             )}
             <div className="flex-1 p-12 flex flex-col justify-between">
                <div>
                   {template.metadata?.companyLogoUrl && (
                      <img src={template.metadata.companyLogoUrl} alt="Logo" className="h-16 object-contain mb-10" />
                   )}
                   <h1 className="text-5xl font-bold text-primary mb-4">Product Name</h1>
                   <p className="text-xl text-muted uppercase tracking-widest font-light">Instruction Manual</p>
                </div>
                <div className="border-t-4 pt-6" style={{ borderColor: 'var(--im-primary-color)' }}>
                   <p className="text-lg font-bold text-primary uppercase mb-1">{template.metadata?.companyName || 'Company Name'}</p>
                   <p className="text-sm text-muted">Original Instructions</p>
                </div>
             </div>
           </div>

           {/* CONTENT PAGES */}
           <div className="p-12 pb-24 min-h-[800px]">
               {rootSections.map((section, index) => renderSection(section, `${index + 1}.`, 0))}
           </div>

           {/* FOOTER */}
           {template.metadata?.footerText && masterPages.body?.footerVariant !== 'none' && (
              <div className={`absolute bottom-0 left-0 right-0 p-6 border-t border-gray-100 text-center text-xs ${masterPages.body?.footerVariant === 'minimal' ? 'text-gray-300' : 'text-gray-400'}`}>
                 {template.metadata.footerText}
              </div>
           )}

           {/* BACK PAGE */}
           {template.metadata?.backPageContent && (
             <div className="min-h-[800px] bg-light p-12 flex flex-col justify-end mt-4 border-t border-gray-200">
                <div className="border-t pt-8" style={{ borderColor: 'var(--im-primary-color)' }}>
                    <div dangerouslySetInnerHTML={{ __html: template.metadata.backPageContent }} />
                    <div className="mt-10 text-xs text-gray-400 text-center">
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