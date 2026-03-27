
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import { 
    getProjectById, getIMTemplateById, getIMSections, 
    getIMTemplates, getProjectIM, saveProjectIM, deleteProjectIM,
    addDocument, uploadFile, getComplianceRequests, getProductFeatures
} from '../../services';
import { Project, IMTemplate, IMSection, ProjectIM, DocStatus, ResponsibleParty, ProductFeature, IMMasterLayoutName, IMMasterPageOverride } from '../../types';
import { ArrowLeft, Save, FileDown, AlertCircle, Image as ImageIcon, CheckCircle, Settings, GitBranch, CheckSquare, Square, X, Printer, Globe, ChevronDown, Download, Code, FileJson, Loader2, Trash2, RotateCcw } from 'lucide-react';
import { renderProjectIMPdf } from '../../services/im/im-print-renderer';
import { getIMThemeVariables } from './styles/im-theme';


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

// Internal Confirmation Modal
const ConfirmationModal: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ isOpen, title, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-primary mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-rose-600 text-white hover:bg-red-700 rounded text-sm font-medium">Delete</button>
        </div>
      </div>
    </div>
  );
};

const ProjectIMGenerator: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  
  const [project, setProject] = useState<Project | null>(null);
  const [templates, setTemplates] = useState<IMTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  
  const [template, setTemplate] = useState<IMTemplate | null>(null);
  const [sections, setSections] = useState<IMSection[]>([]);
  const [instance, setInstance] = useState<ProjectIM | null>(null);
  
  // Form Data
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [conditions, setConditions] = useState<Record<string, boolean>>({});
  
  // Context Data
  const [activeFeatures, setActiveFeatures] = useState<Set<string>>(new Set());
  const [allFeatures, setAllFeatures] = useState<ProductFeature[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  
  // Interactive Editing State
  const [textEditId, setTextEditId] = useState<string | null>(null);
  const [tempTextValue, setTempTextValue] = useState('');
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [activeLang, setActiveLang] = useState('en');

  // Modal State
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (projectId) loadData();
  }, [projectId]);

  // Close export menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
            setShowExportMenu(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
        const proj = await getProjectById(projectId!);
        if (!proj) throw new Error("Project not found");
        setProject(proj);

        // Load compliance data
        const [reqs, feats] = await Promise.all([
            getComplianceRequests(),
            getProductFeatures()
        ]);
        setAllFeatures(feats);

        // Determine active specs from approved/submitted requests
        const projReqs = reqs.filter(r => r.projectId === proj.id);
        const activeFeats = new Set<string>();
        projReqs.forEach(r => {
            r.features.forEach(f => {
                if (f.value) activeFeats.add(f.featureId);
            });
        });
        setActiveFeatures(activeFeats);

        const existingInstance = await getProjectIM(projectId!);
        
        if (existingInstance) {
            setInstance(existingInstance);
            const safeData = existingInstance.placeholderData || {};
            setFormData(safeData);
            
            // Restore conditions from saved data
            const loadedConds: Record<string, boolean> = {};
            Object.keys(safeData).forEach(key => {
                if (key.startsWith('cond_')) {
                    loadedConds[key.replace('cond_', '')] = safeData[key] === 'true';
                }
            });
            setConditions(loadedConds);
            
            // Restore language if saved
            if (safeData['__meta_language']) {
                setActiveLang(safeData['__meta_language']);
            }
            
            await loadTemplate(existingInstance.templateId);
        } else {
             const allTemps = await getIMTemplates();
             setTemplates(allTemps);
        }
    } catch (e) {
        console.error(e);
    } finally {
        setLoading(false);
    }
  };

  const loadTemplate = async (tempId: string) => {
      setSelectedTemplateId(tempId);
      const temp = await getIMTemplateById(tempId);
      const secs = await getIMSections(tempId);
      setTemplate(temp || null);
      setSections(secs);
      
      // Ensure activeLang is valid
      if (temp && temp.languages && !temp.languages.includes(activeLang)) {
          // Only switch if current activeLang is NOT valid for this template
          // This preserves the restored language from loadData if valid
          const safeData = instance?.placeholderData || {};
          const savedLang = safeData['__meta_language'];
          
          if (savedLang && temp.languages.includes(savedLang)) {
              // If saved language is valid, keep it (it was set in loadData)
          } else {
              setActiveLang(temp.languages[0] || 'en');
          }
      }
  };

  // Auto-initialize conditions when sections load
  useEffect(() => {
      if (sections.length > 0 && Object.keys(conditions).length === 0) {
          const defaults: Record<string, boolean> = {};
          const parser = new DOMParser();

          sections.forEach(sec => {
              // Check conditions in ALL languages to be safe, or just EN
              const html = sec.content['en'] || '';
              const doc = parser.parseFromString(html, 'text/html');
              const conds = doc.querySelectorAll('.im-condition');
              
              conds.forEach((el) => {
                  const id = el.getAttribute('data-id');
                  const featureId = el.getAttribute('data-feature-id');
                  
                  if (id) {
                      if (featureId === 'manual') {
                          defaults[id] = false; 
                      } else if (featureId) {
                          defaults[id] = activeFeatures.has(featureId);
                      }
                  }
              });
          });
          setConditions(defaults);
      }
  }, [sections, activeFeatures]);

  const handleTemplateSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val) await loadTemplate(val);
  };

  const handleInputChange = (id: string, value: string) => {
      setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleConditionToggle = (id: string) => {
      setConditions(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleImageUpload = (id: string, file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
          setFormData(prev => ({ ...prev, [id]: reader.result as string }));
      };
      reader.readAsDataURL(file);
  };

  const handlePreviewImageClick = (id: string) => {
      setUploadId(id);
      if (fileInputRef.current) {
          fileInputRef.current.value = '';
          fileInputRef.current.click();
      }
  };

  const handlePreviewTextClick = (id: string) => {
      setTextEditId(id);
      setTempTextValue(formData[id] || '');
  };

  const handleSaveTextModal = () => {
      if (textEditId) {
          handleInputChange(textEditId, tempTextValue);
          setTextEditId(null);
          setTempTextValue('');
      }
  };

  const handlePreviewClick = (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-interactive="true"]');
      if (!target) return;
      
      const id = target.getAttribute('data-id');
      const type = target.getAttribute('data-type');
      
      if (id && type) {
          e.stopPropagation();
          if (type === 'text') {
              handlePreviewTextClick(id);
          } else if (type === 'image') {
              handlePreviewImageClick(id);
          }
      }
  };

  const handleSaveDraft = async () => {
      if (!projectId || !selectedTemplateId) return;
      setSaving(true);
      
      const dataToSave = { ...formData };
      Object.entries(conditions).forEach(([k, v]) => {
          dataToSave[`cond_${k}`] = String(v);
      });
      
      // Save current language
      dataToSave['__meta_language'] = activeLang;

      try {
          const saved = await saveProjectIM(projectId, selectedTemplateId, dataToSave, 'draft');
          setInstance(saved);
          alert("Draft saved successfully!");
      } catch (e) {
          console.error(e);
          alert("Failed to save draft.");
      } finally {
          setSaving(false);
      }
  };

  const handleDeleteDraft = () => {
      setShowDeleteConfirm(true);
  };

  const confirmDeleteDraft = async () => {
      if (!project) return;
      setShowDeleteConfirm(false);
      setLoading(true);
      try {
          const isSavedDraft = !!instance;
          if (isSavedDraft) {
              await deleteProjectIM(project.id);
          }
          
          // Reset State completely
          setInstance(null);
          setFormData({});
          setConditions({});
          setTemplate(null);
          setSections([]);
          setSelectedTemplateId('');
          setActiveLang('en'); // Reset language
          
          // Refresh templates for the selection screen
          const allTemps = await getIMTemplates();
          setTemplates(allTemps);
          
      } catch (e: any) {
          console.error("Error deleting draft:", e);
          alert("Failed to delete draft: " + e.message);
      } finally {
          setLoading(false);
      }
  };

  const handleGenerate = async () => {
      if (!project) {
          console.error("Project missing");
          alert("Could not load project details to generate PDF.");
          return;
      }
      setGenerating(true);
      
      try {
          const shouldUseLegacyRenderer =
              import.meta.env.VITE_IM_PDF_LEGACY_HTML2CANVAS === 'true' ||
              window.localStorage.getItem('im.export.legacyHtml2canvas') === 'true';

          const pdfBlob = await renderProjectIMPdf({
              previewElement: previewRef.current,
              projectName: project.name,
              language: activeLang,
              template,
              sections,
              formData,
              conditions,
              useLegacyHtml2Canvas: shouldUseLegacyRenderer,
          });

          const fileName = `${project.name.replace(/\s+/g, '_')}_Manual_${activeLang.toUpperCase()}.pdf`;
          const file = new File([pdfBlob], fileName, { type: "application/pdf" });

          const docTitle = `Generated Manual (${activeLang.toUpperCase()}) - ${new Date().toLocaleDateString()}`;
          const newDoc = await addDocument({
             projectId: project.id,
             stepNumber: project.currentStep || 3,
             title: docTitle,
             description: `Generated from IM Template in ${activeLang.toUpperCase()}`,
             responsibleParty: ResponsibleParty.INTERNAL,
             isVisibleToSupplier: true,
             isRequired: false,
             status: DocStatus.APPROVED
          });
          
          await uploadFile(newDoc.id, file, false);
          
          const dataToSave = { ...formData };
          Object.entries(conditions).forEach(([k, v]) => {
             dataToSave[`cond_${k}`] = String(v);
          });
          dataToSave['__meta_language'] = activeLang;
          
          await saveProjectIM(project.id, selectedTemplateId, dataToSave, 'generated');

          alert("Manual generated and uploaded successfully!");
          navigate(`/project/${project.id}`);

      } catch (e: any) {
          console.error("Generation failed", e);
          alert(`Failed to generate PDF: ${e.message}`);
      } finally {
          setGenerating(false);
      }
  };
  
  // ---------------- EXPORT HELPERS ----------------

  const escapeXml = (unsafe: string) => {
      if (!unsafe) return '';
      return unsafe.replace(/[<>&'"]/g, function (c) {
          switch (c) {
              case '<': return '&lt;';
              case '>': return '&gt;';
              case '&': return '&amp;';
              case '\'': return '&apos;';
              case '"': return '&quot;';
          }
          return c;
      });
  };

  const getCleanContent = (html: string) => {
      if (!html) return '';
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Process Conditions
      const conditionNodes = doc.querySelectorAll('.im-condition');
      conditionNodes.forEach((node) => {
          const el = node as HTMLElement;
          const id = el.getAttribute('data-id');
          const contentEncoded = el.getAttribute('data-content');
          
          if (id && conditions[id] && contentEncoded) {
              try {
                  const content = decodeURIComponent(contentEncoded);
                  const textNode = document.createTextNode(content);
                  el.replaceWith(textNode);
              } catch(e) { el.remove(); }
          } else { el.remove(); }
      });

      // Process Placeholders (Clean replacement)
      const placeholderNodes = doc.querySelectorAll('.im-placeholder');
      placeholderNodes.forEach((node) => {
          const el = node as HTMLElement;
          const id = el.getAttribute('data-id');
          const type = el.getAttribute('data-type');
          
          if (!id || !type) return;
          const val = formData[id];

          if (type === 'image') {
             if (val) {
                 const img = document.createElement('img');
                 img.src = val;
                 // Base64 images might be huge for XML, but we keep them for data integrity or strip them for text exports
                 el.replaceWith(img);
             } else {
                 el.remove();
             }
          } else {
             const span = document.createElement('span');
             span.textContent = val || '';
             el.replaceWith(span);
          }
      });

      return doc.body.innerHTML;
  };

  const downloadData = (data: string, filename: string, type: string) => {
      const blob = new Blob([data], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleExport = (format: 'json' | 'xml') => {
      if (!project) return;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${project.name.replace(/\s+/g, '_')}_${activeLang}_${timestamp}.${format}`;

      if (format === 'json') {
          const data = {
              project: { name: project.name, id: project.projectId },
              metadata: {
                  title: formData['__cover_title'],
                  subtitle: formData['__cover_subtitle'],
                  language: activeLang,
                  exportDate: new Date().toISOString()
              },
              sections: orderedSections.map(s => ({
                  id: s.id,
                  title: s.title,
                  order: s.order,
                  content_html: getCleanContent(s.content[activeLang] || '')
              }))
          };
          downloadData(JSON.stringify(data, null, 2), filename, 'application/json');
      } else if (format === 'xml') {
          // InDesign / Generic XML format
          let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<InstructionManual>\n`;
          xml += `  <Metadata>\n`;
          xml += `    <ProjectName>${escapeXml(project.name)}</ProjectName>\n`;
          xml += `    <ProjectId>${escapeXml(project.projectId)}</ProjectId>\n`;
          xml += `    <ExportDate>${new Date().toISOString()}</ExportDate>\n`;
          xml += `    <Language>${activeLang}</Language>\n`;
          xml += `    <CoverTitle>${escapeXml(formData['__cover_title'] || project.name)}</CoverTitle>\n`;
          xml += `    <CoverSubtitle>${escapeXml(formData['__cover_subtitle'] || 'INSTRUCTION MANUAL')}</CoverSubtitle>\n`;
          xml += `  </Metadata>\n`;
          xml += `  <Sections>\n`;
          
          orderedSections.forEach(s => {
              const rawContent = getCleanContent(s.content[activeLang] || '');
              // Strip tags for a clean text version
              const textContent = rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              
              xml += `    <Section id="${s.id}">\n`;
              xml += `      <Title>${escapeXml(s.title)}</Title>\n`;
              xml += `      <Order>${s.order}</Order>\n`;
              xml += `      <HtmlContent><![CDATA[${rawContent}]]></HtmlContent>\n`;
              xml += `      <PlainText>${escapeXml(textContent)}</PlainText>\n`;
              xml += `    </Section>\n`;
          });
          
          xml += `  </Sections>\n`;
          xml += `</InstructionManual>`;
          downloadData(xml, filename, 'application/xml');
      }
      setShowExportMenu(false);
  };

  // ---------------- EDITOR LOGIC ----------------

  const processContent = (html: string) => {
      if (!html) return '';
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Process Conditions
      const conditionNodes = doc.querySelectorAll('.im-condition');
      conditionNodes.forEach((node) => {
          const el = node as HTMLElement;
          const id = el.getAttribute('data-id');
          const contentEncoded = el.getAttribute('data-content');
          
          if (id && conditions[id] && contentEncoded) {
              try {
                  const content = decodeURIComponent(contentEncoded);
                  const textNode = document.createTextNode(content);
                  el.replaceWith(textNode);
              } catch(e) { el.remove(); }
          } else { el.remove(); }
      });

      // Process Placeholders
      const placeholderNodes = doc.querySelectorAll('.im-placeholder');
      placeholderNodes.forEach((node) => {
          const el = node as HTMLElement;
          const id = el.getAttribute('data-id');
          const type = el.getAttribute('data-type');
          
          if (!id || !type) return;

          const val = formData[id];
          const wrapperClass = "im-interactive-placeholder cursor-pointer rounded transition-all inline-block align-middle hover:ring-2 hover:ring-offset-1 hover:ring-indigo-400";

          const wrapper = document.createElement(type === 'image' && val ? 'div' : 'span');
          wrapper.className = wrapperClass;
          wrapper.setAttribute('data-interactive', 'true');
          wrapper.setAttribute('data-id', id);
          wrapper.setAttribute('data-type', type);
          
          if (type === 'image') {
             if (val) {
                 wrapper.className += " relative group";
                 wrapper.innerHTML = `<img src="${val}" class="max-w-full h-auto" /><div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white font-bold text-xs">Change Image</div>`;
             } else {
                 let label = 'Image';
                 const labelAttr = el.getAttribute('data-label');
                 if (labelAttr) try { label = decodeURIComponent(labelAttr); } catch(e) {}
                 else {
                      const text = el.textContent?.trim() || '';
                      if (text.startsWith('[') && text.endsWith(']')) label = text.substring(1, text.length-1);
                 }

                 wrapper.className += " bg-indigo-50 text-indigo-600 px-3 py-2 text-xs font-bold border border-dashed border-indigo-300 hover:bg-indigo-100";
                 wrapper.innerHTML = `<span style="display:flex;align-items:center;gap:4px">🖼️ ${label}</span>`;
             }
          } else {
             if (val) {
                 wrapper.className += " border-b-2 border-indigo-100 hover:border-indigo-400 px-1 hover:bg-indigo-50";
                 wrapper.textContent = val;
             } else {
                 let label = 'Text';
                 const labelAttr = el.getAttribute('data-label');
                 if (labelAttr) try { label = decodeURIComponent(labelAttr); } catch(e) {}
                 else {
                      const text = el.textContent?.trim() || '';
                      if (text.startsWith('[') && text.endsWith(']')) label = text.substring(1, text.length-1);
                 }

                 wrapper.className += " bg-amber-50 text-yellow-700 px-2 py-0.5 text-xs font-bold border border-dashed border-yellow-300 hover:bg-amber-100 mx-1";
                 wrapper.textContent = `[ ${label} ]`;
             }
          }
          el.replaceWith(wrapper);
      });

      return doc.body.innerHTML;
  };

  const getItemsInSection = (html: string) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const items: { id: string; kind: 'placeholder' | 'condition'; type?: 'text' | 'image'; featureId?: string; label?: string }[] = [];

      const placeholders = doc.querySelectorAll('.im-placeholder');
      placeholders.forEach((el) => {
          const id = el.getAttribute('data-id');
          const type = el.getAttribute('data-type');
          let label = type === 'text' ? 'Text Input' : 'Image Upload';
          
          const labelAttr = el.getAttribute('data-label');
          if (labelAttr) {
              try {
                  label = decodeURIComponent(labelAttr);
              } catch(e) {}
          } else {
              // Fallback to text content
              const text = el.textContent?.trim() || '';
              if (text.startsWith('[') && text.endsWith(']')) {
                  label = text.substring(1, text.length - 1);
              }
          }

          if (id && type) items.push({ id, kind: 'placeholder', type: type as 'text'|'image', label });
      });

      const conditionNodes = doc.querySelectorAll('.im-condition');
      conditionNodes.forEach((el) => {
          const id = el.getAttribute('data-id');
          const featureId = el.getAttribute('data-feature-id');
          const contentEncoded = el.getAttribute('data-content');
          if (id && featureId && contentEncoded) {
              let snippet = '';
              try {
                  const content = decodeURIComponent(contentEncoded);
                  snippet = content.length > 40 ? content.substring(0, 40) + '...' : content;
              } catch (e) { snippet = 'Error decoding content'; }
              items.push({ id, kind: 'condition', featureId, label: snippet });
          }
      });
      return items;
  };

  const calculateCompletion = (lang: string) => {
      let total = 0;
      let filled = 0;
      
      sections.forEach(s => {
          const content = s.content[lang] || '';
          const items = getItemsInSection(content);
          items.forEach(i => {
              if (i.kind === 'placeholder') {
                  total++;
                  if (formData[i.id]) filled++;
              }
          });
      });
      
      if (total === 0) return { status: 'ready', label: 'Ready (No Inputs)' };
      return {
          status: filled === total ? 'ready' : 'incomplete',
          label: `${filled}/${total} Filled`
      };
  };

  if (loading) return <Layout><div>Loading...</div></Layout>;

  if (!selectedTemplateId) {
      return (
          <Layout>
              <div className="max-w-2xl mx-auto mt-10">
                  <h1 className="text-3xl font-bold text-primary mb-6">Generate Instruction Manual</h1>
                  <div className="bg-white p-8 rounded-xl border border-gray-200 shadow">
                      <label className="block font-medium text-gray-700 mb-2">Select a Template</label>
                      <select className="w-full p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" onChange={handleTemplateSelect} defaultValue="">
                          <option value="" disabled>-- Choose a Template --</option>
                          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                  </div>
              </div>
          </Layout>
      );
  }

  const orderedSections = sections.sort((a, b) => a.order - b.order);
  const imThemeVars = getIMThemeVariables(template?.metadata);
  const masterPages = {
    ...DEFAULT_MASTER_PAGES,
    ...(template?.metadata?.masterPages || {})
  };
  
  // Computed values for current language
  const displayTitle = formData['__cover_title'] !== undefined ? formData['__cover_title'] : (project?.name || 'Product Name');
  const displaySubtitle = formData['__cover_subtitle'] !== undefined ? formData['__cover_subtitle'] : 'INSTRUCTION MANUAL';
  const displayLogo = formData['__custom_logo'] || template?.metadata?.companyLogoUrl;
  const displayCoverImage = formData['__custom_cover_image'] || template?.metadata?.coverImageUrl;
  const displayFooter = formData['__custom_footer'] !== undefined ? formData['__custom_footer'] : (template?.metadata?.footerText || '');

  const completion = calculateCompletion(activeLang);

  return (
    <Layout>
       <ConfirmationModal 
         isOpen={showDeleteConfirm}
         title={instance ? "Delete Draft?" : "Reset Template?"}
         message={instance ? "Are you sure you want to delete this saved draft? All progress will be lost permanently." : "Are you sure you want to reset? Any unsaved changes will be lost."}
         onConfirm={confirmDeleteDraft}
         onCancel={() => setShowDeleteConfirm(false)}
       />


       <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="image/*" 
          onChange={(e) => e.target.files?.[0] && uploadId && handleImageUpload(uploadId, e.target.files[0])} 
       />

       <div className="h-[calc(100vh-100px)] flex flex-col" style={imThemeVars}>
           <div className="flex justify-between items-center mb-4">
               <div className="flex items-center gap-3">
                   <button onClick={() => navigate(`/project/${projectId}`)} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></button>
                   <div>
                       <h2 className="text-xl font-bold text-primary">{template?.name}</h2>
                       <div className="flex items-center gap-2 text-xs text-muted">
                          <span>For: {project?.name}</span>
                          {instance?.status === 'generated' && <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">GENERATED</span>}
                       </div>
                   </div>
               </div>
               <div className="flex gap-3 items-center">
                   <button 
                        onClick={handleDeleteDraft} 
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-rose-200 text-rose-600 rounded-xl text-sm font-medium hover:bg-rose-50 transition-colors"
                        disabled={loading || saving}
                   >
                       {instance ? <Trash2 size={16} /> : <RotateCcw size={16} />}
                       {instance ? 'Delete Draft' : 'Reset'}
                   </button>

                   <button onClick={handleSaveDraft} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-light"><Save size={16} /> Save Draft</button>
                   
                   {/* Export Menu */}
                   <div className="relative" ref={exportMenuRef}>
                       <button 
                          onClick={() => setShowExportMenu(!showExportMenu)}
                          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-light"
                       >
                          <Download size={16} /> Export Data <ChevronDown size={14} />
                       </button>
                       {showExportMenu && (
                           <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-200 z-50 py-1">
                               <button 
                                  onClick={() => handleExport('json')}
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-light flex items-center gap-2"
                               >
                                  <FileJson size={16} /> Export as JSON
                               </button>
                               <button 
                                  onClick={() => handleExport('xml')}
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-light flex items-center gap-2"
                               >
                                  <Code size={16} /> XML (InDesign)
                               </button>
                           </div>
                       )}
                   </div>

                   <button onClick={handleGenerate} disabled={generating} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-70">
                      {generating ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
                      {generating ? 'Generating...' : `Generate PDF (${activeLang.toUpperCase()})`}
                   </button>
               </div>
           </div>

           <div className="flex flex-1 gap-6 overflow-hidden">
               {/* LEFT: INPUTS */}
               <div className="w-1/3 bg-white border border-gray-200 rounded-xl shadow flex flex-col overflow-hidden">
                   <div className="p-4 bg-light border-b border-gray-200 font-bold text-gray-700 flex items-center justify-between">
                       <div className="flex items-center gap-2"><Settings size={16} /> Configuration</div>
                       <span className="text-xs font-normal text-muted bg-gray-200 px-2 py-0.5 rounded">Language: {activeLang.toUpperCase()}</span>
                   </div>
                   <div className="flex-1 overflow-y-auto p-6 space-y-8">
                       
                       {/* COVER PAGE CONFIG */}
                       <div className="border-b border-gray-100 pb-6">
                            <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
                                <span className="bg-gray-800 text-white px-1.5 py-0.5 rounded">Cover</span> Cover Page & Branding
                            </h4>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-muted uppercase tracking-wide mb-1">Manual Title</label>
                                    <input className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" value={displayTitle} onChange={(e) => handleInputChange('__cover_title', e.target.value)} placeholder={project?.name} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted uppercase tracking-wide mb-1">Subtitle</label>
                                    <input className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" value={displaySubtitle} onChange={(e) => handleInputChange('__cover_subtitle', e.target.value)} />
                                </div>
                            </div>
                       </div>

                       {orderedSections.map(section => {
                           // Get items for the ACTIVE language
                           const contentHtml = section.content[activeLang] || '';
                           const items = getItemsInSection(contentHtml);
                           
                           // If no content for this language, skip showing inputs
                           if (items.length === 0 && !section.isPlaceholder) return null;
                           
                           return (
                               <div key={section.id} className="border-b border-gray-100 pb-6 last:border-0">
                                   <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
                                       <span className="bg-gray-100 px-1.5 py-0.5 rounded text-muted">Sec {section.order}</span> {section.title}
                                   </h4>
                                   {section.isPlaceholder && <div className="mb-4 bg-indigo-50 p-3 rounded border border-indigo-100 text-xs text-blue-800"><AlertCircle size={14} className="inline mr-1"/> Placeholder Section</div>}
                                   {!contentHtml && !section.isPlaceholder && <div className="text-xs text-gray-400 italic mb-2">No content defined for {activeLang.toUpperCase()}.</div>}

                                   <div className="space-y-5">
                                       {items.map((item, idx) => {
                                           const isFilled = !!formData[item.id];
                                           const featName = item.featureId !== 'manual' ? (allFeatures.find(f => f.id === item.featureId)?.name || 'Unknown Feature') : null;
                                           return (
                                               <div key={`${item.id}-${idx}`} className="group">
                                                   {item.kind === 'condition' ? (
                                                       <div onClick={() => handleConditionToggle(item.id)} className={`p-3 rounded border cursor-pointer transition-all ${conditions[item.id] ? 'bg-purple-50 border-purple-200 shadow' : 'bg-white border-gray-200 hover:bg-light'}`}>
                                                          <div className="flex items-start gap-3">
                                                              <div className="mt-0.5 text-indigo-600">
                                                                  {conditions[item.id] ? <CheckSquare size={18} /> : <Square size={18} className="text-gray-400" />}
                                                              </div>
                                                              <div>
                                                                  <div className="text-xs font-bold uppercase text-muted mb-1 flex items-center gap-1 select-none"><GitBranch size={12}/> {item.featureId === 'manual' ? 'Optional Block' : 'Feature Block'} {featName && <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] ml-1 truncate max-w-[120px]">{featName}</span>}</div>
                                                                  <p className={`text-sm text-gray-700 select-none ${!conditions[item.id] && 'opacity-50 line-through'}`}>"{item.label}"</p>
                                                              </div>
                                                          </div>
                                                       </div>
                                                   ) : (
                                                       <div>
                                                           <div className="flex justify-between items-center mb-1.5">
                                                               <label className="block text-xs font-bold text-muted uppercase tracking-wide">{item.label}</label>
                                                               {isFilled ? <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1 bg-emerald-50 px-1.5 py-0.5 rounded"><CheckCircle size={10}/> Filled</span> : <span className="text-[10px] font-bold text-orange-500 flex items-center gap-1 bg-amber-50 px-1.5 py-0.5 rounded"><AlertCircle size={10}/> Required</span>}
                                                           </div>
                                                           {item.type === 'text' ? (
                                                               <textarea className={`w-full border rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none ${isFilled ? 'border-gray-300 bg-light' : 'border-amber-200 bg-white'}`} rows={2} placeholder="Content..." value={formData[item.id] || ''} onChange={(e) => handleInputChange(item.id, e.target.value)} />
                                                           ) : (
                                                               <div className="space-y-2">
                                                                   <label className={`block w-full border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-colors ${isFilled ? 'border-gray-200 hover:bg-light' : 'border-amber-200 bg-amber-50/30 hover:bg-amber-50'}`}>
                                                                       <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleImageUpload(item.id, e.target.files[0])} />
                                                                       <ImageIcon className={`mx-auto mb-1 ${isFilled ? 'text-gray-400' : 'text-orange-400'}`} size={20} />
                                                                       <span className={`text-xs ${isFilled ? 'text-muted' : 'text-amber-600 font-medium'}`}>{isFilled ? 'Replace Image' : 'Click to Upload Image'}</span>
                                                                   </label>
                                                               </div>
                                                           )}
                                                       </div>
                                                   )}
                                               </div>
                                           );
                                       })}
                                   </div>
                               </div>
                           );
                       })}
                   </div>
               </div>

               {/* RIGHT: PREVIEW */}
               <div className="flex-1 bg-white border border-gray-200 rounded-xl shadow flex flex-col overflow-hidden">
                   <div className="p-4 bg-light border-b border-gray-200 font-bold text-gray-700 flex justify-between items-center">
                       <span>Live Preview</span>
                       <div className="flex items-center gap-3">
                           {/* Status Badge */}
                           <div className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5 font-medium transition-colors ${completion.status === 'ready' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-orange-700 border-amber-200'}`}>
                               {completion.status === 'ready' ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                               {completion.label}
                           </div>

                           {/* Language Selector */}
                           <div className="flex items-center gap-1 bg-white border border-gray-300 rounded px-2 py-1 text-xs shadow">
                               <Globe size={12} className="text-gray-400"/>
                               <select 
                                  value={activeLang} 
                                  onChange={(e) => setActiveLang(e.target.value)}
                                  className="bg-transparent outline-none text-gray-700 font-bold cursor-pointer appearance-none pr-4 relative z-10"
                               >
                                  {(template?.languages || ['en']).map(code => (
                                     <option key={code} value={code}>{code.toUpperCase()}</option>
                                  ))}
                               </select>
                               <ChevronDown size={10} className="text-gray-400 -ml-3 z-0 pointer-events-none" />
                           </div>
                           <span className="text-xs text-muted border-l pl-2 border-gray-300 flex items-center gap-1"><Printer size={12}/> A4</span>
                       </div>
                   </div>
                   <div className="flex-1 overflow-y-auto bg-gray-100 p-8 flex justify-center" onClick={handlePreviewClick}>
                       <div ref={previewRef} className="bg-white shadow-lg w-[210mm] min-h-[297mm] origin-top">
                          {/* COVER PAGE */}
                          <div className="min-h-[297mm] flex flex-col relative bg-white mb-4 break-after-page" style={getBackgroundStyle(masterPages.cover)}>
                             {displayCoverImage && <div className="h-[400px] bg-cover bg-center" style={{ backgroundImage: `url(${displayCoverImage})` }} />}
                             <div className="flex-1 p-[20mm] flex flex-col justify-between">
                                <div>
                                   {displayLogo && <img src={displayLogo} alt="Logo" className="h-12 object-contain mb-10" />}
                                   <h1 className="text-4xl font-bold text-primary mb-4">{displayTitle}</h1>
                                   <p className="text-xl text-muted uppercase tracking-widest font-light">{displaySubtitle}</p>
                                </div>
                                <div className="border-t-4 pt-6" style={{ borderColor: 'var(--im-primary-color)' }}>
                                   <p className="text-sm font-bold text-primary uppercase mb-1">{template?.metadata?.companyName || 'Company Name'}</p>
                                   <p className="text-xs text-muted">Original Instructions</p>
                                </div>
                             </div>
                          </div>
                          {/* CONTENT */}
                          <div className="p-[20mm] pb-[30mm] min-h-[297mm] bg-white relative">
                              <div className="space-y-6 text-gray-800 text-sm leading-relaxed">
                                  {orderedSections.map(section => (
                                      <div key={section.id} className="mb-8">
                                          <h3 className="text-lg font-bold text-primary mb-3 border-b pb-2" style={{ borderColor: 'var(--im-primary-color)' }}>{section.title}</h3>
                                          <div className="im-content" dangerouslySetInnerHTML={{ __html: processContent(section.content[activeLang] || '') }} />
                                      </div>
                                  ))}
                              </div>
                              
                              {/* FOOTER */}
                              {displayFooter && masterPages.body?.footerVariant !== 'none' && (
                                  <div className={`absolute bottom-0 left-0 right-0 p-8 border-t border-gray-100 text-center text-xs ${masterPages.body?.footerVariant === 'minimal' ? 'text-gray-300' : 'text-gray-400'}`}>
                                      {displayFooter}
                                  </div>
                              )}
                          </div>

                          {/* BACK PAGE */}
                          {template?.metadata?.backPageContent && (
                              <div className="min-h-[297mm] bg-light p-[20mm] flex flex-col justify-end mt-4 break-before-page">
                                  <div className="border-t pt-8" style={{ borderColor: 'var(--im-primary-color)' }}>
                                      <div dangerouslySetInnerHTML={{ __html: template.metadata.backPageContent }} />
                                      <div className="mt-10 text-xs text-gray-400 text-center">
                                          &copy; {new Date().getFullYear()} {template.metadata.companyName || 'Company Name'}. All rights reserved.
                                      </div>
                                  </div>
                              </div>
                          )}
                       </div>
                   </div>
               </div>
           </div>

           {/* Text Edit Modal */}
           {textEditId && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg">Edit Text</h3>
                            <button onClick={() => setTextEditId(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <textarea 
                            className="w-full border p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" 
                            rows={4} 
                            value={tempTextValue} 
                            onChange={(e) => setTempTextValue(e.target.value)} 
                            autoFocus
                        />
                        <div className="flex justify-end gap-3 mt-4">
                            <button onClick={() => setTextEditId(null)} className="text-gray-600 hover:bg-light px-4 py-2 rounded">Cancel</button>
                            <button onClick={handleSaveTextModal} className="bg-indigo-600 text-white px-4 py-2 rounded font-medium hover:bg-indigo-700">Save Update</button>
                        </div>
                    </div>
                </div>
            )}
       </div>
    </Layout>
  );
};

export default ProjectIMGenerator;
